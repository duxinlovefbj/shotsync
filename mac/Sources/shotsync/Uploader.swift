import Foundation
import ShotsyncCore

final class Uploader {
  private static let directUploadLimit: Int64 = 90 * 1024 * 1024
  private static let maxMultipartSize: Int64 = 3 * 1024 * 1024 * 1024
  private static let chunkSize = 50 * 1024 * 1024

  private struct MultipartPart: Codable {
    let partNumber: Int
    let etag: String
  }

  private struct MultipartState: Codable {
    let fileSize: Int64
    let modifiedAt: TimeInterval
    let id: String
    let uploadId: String
    let uploadToken: String
    let chunkSize: Int
    var parts: [Int: MultipartPart]
  }

  private struct InitResponse: Decodable {
    let id: String
    let uploadId: String
    let uploadToken: String
    let chunkSize: Int
  }

  private struct CompleteBody: Encodable {
    let id: String
    let uploadId: String
    let parts: [MultipartPart]
  }

  private enum PartUploadResult {
    case success(MultipartPart)
    case expired
    case failed
  }

  private let queue: UploadQueue
  private let stateURL: URL
  private let session = URLSession(configuration: .default)
  private let stateLock = NSLock()
  private var states: [String: MultipartState]

  init(queue: UploadQueue, stateURL: URL) {
    self.queue = queue
    self.stateURL = stateURL
    if let data = try? Data(contentsOf: stateURL),
       let decoded = try? JSONDecoder().decode([String: MultipartState].self, from: data) {
      self.states = decoded
    } else {
      self.states = [:]
    }
  }

  func upload(path: String, completion: @escaping (Bool) -> Void) {
    guard !isUploaded(path) else { completion(true); return }
    guard let baseURL = Config.baseURL, let token = Config.token() else { completion(false); return }
    guard let info = fileInfo(path: path) else { completion(false); return }
    guard info.size <= Self.maxMultipartSize else { completion(false); return }

    if info.size > Self.directUploadLimit {
      uploadMultipart(path: path, baseURL: baseURL, token: token,
                      size: info.size, modifiedAt: info.modifiedAt, sessionAttempt: 0,
                      completion: completion)
      return
    }

    guard let full = try? Data(contentsOf: URL(fileURLWithPath: path)) else { completion(false); return }
    let thumb = encodeThumbnailJPEG(pngData: full, maxEdge: 480, quality: 0.7)
    let filename = (path as NSString).lastPathComponent
    let boundary = "shotsync-\(UUID().uuidString)"
    let req = buildUploadRequest(baseURL: baseURL, token: token, filename: filename,
                                 full: full, thumb: thumb, boundary: boundary)
    session.dataTask(with: req) { _, resp, error in
      let ok = error == nil && (resp as? HTTPURLResponse)?.statusCode == 200
      if ok { _ = markUploaded(path); self.queue.remove(path) }
      else { self.queue.recordFailure(path) }
      completion(ok)
    }.resume()
  }

  func enqueueAndUpload(_ path: String) { queue.enqueue(path); upload(path: path) { _ in } }

  func drainQueue() {
    for item in queue.all() { upload(path: item.path) { _ in } }
  }

  private func fileInfo(path: String) -> (size: Int64, modifiedAt: TimeInterval)? {
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: path),
          let size = (attrs[.size] as? NSNumber)?.int64Value,
          let modified = (attrs[.modificationDate] as? Date)?.timeIntervalSince1970,
          size >= 0 else { return nil }
    return (size, modified)
  }

  private func state(for path: String) -> MultipartState? {
    stateLock.lock(); defer { stateLock.unlock() }
    return states[path]
  }

  private func save(_ state: MultipartState, for path: String) {
    stateLock.lock(); defer { stateLock.unlock() }
    states[path] = state
    persistStatesLocked()
  }

  private func removeState(for path: String) {
    stateLock.lock(); defer { stateLock.unlock() }
    states.removeValue(forKey: path)
    persistStatesLocked()
  }

  private func persistStatesLocked() {
    guard let data = try? JSONEncoder().encode(states) else { return }
    try? data.write(to: stateURL, options: .atomic)
  }

  private func uploadMultipart(
    path: String,
    baseURL: URL,
    token: String,
    size: Int64,
    modifiedAt: TimeInterval,
    sessionAttempt: Int,
    completion: @escaping (Bool) -> Void
  ) {
    if let saved = state(for: path), saved.fileSize == size, saved.modifiedAt == modifiedAt,
                        saved.chunkSize == Self.chunkSize {
      continueMultipart(path: path, baseURL: baseURL, token: token, state: saved,
                        sessionAttempt: sessionAttempt, completion: completion)
      return
    }

    removeState(for: path)
    var req = URLRequest(url: baseURL.appendingPathComponent("api/upload/multipart/init"))
    req.httpMethod = "POST"
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("mac", forHTTPHeaderField: "X-Source")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let filename = (path as NSString).lastPathComponent
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
      "filename": filename,
      "contentType": "image/png",
      "size": size,
    ])

    session.dataTask(with: req) { data, response, error in
      guard error == nil,
            (response as? HTTPURLResponse)?.statusCode == 200,
            let data,
            let initResponse = try? JSONDecoder().decode(InitResponse.self, from: data),
            !initResponse.id.isEmpty,
            !initResponse.uploadId.isEmpty,
            !initResponse.uploadToken.isEmpty,
            initResponse.chunkSize == Self.chunkSize else {
        self.queue.recordFailure(path)
        completion(false)
        return
      }

      let state = MultipartState(fileSize: size, modifiedAt: modifiedAt,
                                 id: initResponse.id, uploadId: initResponse.uploadId,
                                 uploadToken: initResponse.uploadToken,
                                 chunkSize: initResponse.chunkSize, parts: [:])
      self.save(state, for: path)
      self.continueMultipart(path: path, baseURL: baseURL, token: token, state: state,
                             sessionAttempt: sessionAttempt, completion: completion)
    }.resume()
  }

  private func continueMultipart(
    path: String,
    baseURL: URL,
    token: String,
    state: MultipartState,
    sessionAttempt: Int,
    completion: @escaping (Bool) -> Void
  ) {
    let totalParts = Int((state.fileSize + Int64(state.chunkSize) - 1) / Int64(state.chunkSize))
    guard totalParts > 0 else { queue.recordFailure(path); completion(false); return }

    if let next = (1...totalParts).first(where: { state.parts[$0] == nil }) {
      uploadPart(path: path, baseURL: baseURL, token: token, state: state, partNumber: next, attempt: 0) { result in
        switch result {
        case .success(let part):
          var updated = state
          updated.parts[part.partNumber] = part
          self.save(updated, for: path)
          self.continueMultipart(path: path, baseURL: baseURL, token: token, state: updated,
                                 sessionAttempt: sessionAttempt, completion: completion)
        case .expired:
          if sessionAttempt == 0 {
            self.removeState(for: path)
            self.uploadMultipart(path: path, baseURL: baseURL, token: token,
                                 size: state.fileSize, modifiedAt: state.modifiedAt,
                                 sessionAttempt: 1, completion: completion)
          } else {
            self.queue.recordFailure(path)
            completion(false)
          }
        case .failed:
          self.queue.recordFailure(path)
          completion(false)
        }
      }
      return
    }

    let parts = (1...totalParts).compactMap { state.parts[$0] }
    guard parts.count == totalParts else { queue.recordFailure(path); completion(false); return }
    completeMultipart(path: path, baseURL: baseURL, token: token, state: state,
                      parts: parts, attempt: 0, sessionAttempt: sessionAttempt,
                      completion: completion)
  }

  private func uploadPart(
    path: String,
    baseURL: URL,
    token: String,
    state: MultipartState,
    partNumber: Int,
    attempt: Int,
    completion: @escaping (PartUploadResult) -> Void
  ) {
    let start = Int64(partNumber - 1) * Int64(state.chunkSize)
    let length = Int(min(Int64(state.chunkSize), state.fileSize - start))
    guard let data = readPart(path: path, offset: start, length: length) else {
      completion(.failed)
      return
    }

    var components = URLComponents(url: baseURL.appendingPathComponent("api/upload/multipart/part"),
                                   resolvingAgainstBaseURL: false)!
    components.queryItems = [
      URLQueryItem(name: "id", value: state.id),
      URLQueryItem(name: "uploadId", value: state.uploadId),
      URLQueryItem(name: "partNumber", value: String(partNumber)),
    ]
    var req = URLRequest(url: components.url!)
    req.httpMethod = "PUT"
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue(state.uploadToken, forHTTPHeaderField: "X-Multipart-Token")
    req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
    req.setValue(String(data.count), forHTTPHeaderField: "Content-Length")
    req.httpBody = data

    session.dataTask(with: req) { responseData, response, error in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if status == 401 || status == 404 {
        completion(.expired)
        return
      }
      if error == nil, status == 200, let responseData,
         let part = try? JSONDecoder().decode(MultipartPart.self, from: responseData),
         part.partNumber == partNumber, !part.etag.isEmpty {
        completion(.success(part))
        return
      }
      if attempt < 2 && (error != nil || status == 429 || status >= 500) {
        let delay = UInt64(500 * (1 << attempt)) * 1_000_000
        DispatchQueue.global().asyncAfter(deadline: .now() + .nanoseconds(Int(delay))) {
          self.uploadPart(path: path, baseURL: baseURL, token: token, state: state,
                          partNumber: partNumber, attempt: attempt + 1, completion: completion)
        }
        return
      }
      completion(.failed)
    }.resume()
  }

  private func completeMultipart(
    path: String,
    baseURL: URL,
    token: String,
    state: MultipartState,
    parts: [MultipartPart],
    attempt: Int,
    sessionAttempt: Int,
    completion: @escaping (Bool) -> Void
  ) {
    var req = URLRequest(url: baseURL.appendingPathComponent("api/upload/multipart/complete"))
    req.httpMethod = "POST"
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue(state.uploadToken, forHTTPHeaderField: "X-Multipart-Token")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONEncoder().encode(CompleteBody(id: state.id, uploadId: state.uploadId, parts: parts))

    session.dataTask(with: req) { _, response, error in
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      if status == 401 || status == 404 {
        if sessionAttempt == 0 {
          self.removeState(for: path)
          self.uploadMultipart(path: path, baseURL: baseURL, token: token,
                               size: state.fileSize, modifiedAt: state.modifiedAt,
                               sessionAttempt: 1, completion: completion)
        } else {
          self.queue.recordFailure(path)
          completion(false)
        }
        return
      }
      if error == nil, status == 200 {
        self.removeState(for: path)
        _ = markUploaded(path)
        self.queue.remove(path)
        completion(true)
        return
      }
      if attempt < 2 && (error != nil || status == 429 || status >= 500) {
        let delay = UInt64(500 * (1 << attempt)) * 1_000_000
        DispatchQueue.global().asyncAfter(deadline: .now() + .nanoseconds(Int(delay))) {
          self.completeMultipart(path: path, baseURL: baseURL, token: token, state: state,
                                 parts: parts, attempt: attempt + 1,
                                 sessionAttempt: sessionAttempt, completion: completion)
        }
        return
      }
      self.queue.recordFailure(path)
      completion(false)
    }.resume()
  }

  private func readPart(path: String, offset: Int64, length: Int) -> Data? {
    guard length > 0 else { return nil }
    do {
      let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
      defer { try? handle.close() }
      try handle.seek(toOffset: UInt64(offset))
      guard let data = try handle.read(upToCount: length), data.count == length else { return nil }
      return data
    } catch {
      return nil
    }
  }
}
