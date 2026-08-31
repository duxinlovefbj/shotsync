import AppKit
import ShotsyncCore

final class SystemDefaultsBackend: DefaultsBackend {
  private func run(_ launch: String, _ args: [String]) {
    let p = Process(); p.executableURL = URL(fileURLWithPath: launch); p.arguments = args
    try? p.run(); p.waitUntilExit()
  }
  func read() -> String? {
    let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/defaults")
    p.arguments = ["read", "com.apple.screencapture", "location"]
    let pipe = Pipe(); p.standardOutput = pipe; p.standardError = Pipe()
    try? p.run(); p.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let s = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    return (s?.isEmpty == false) ? s : nil
  }
  func write(_ value: String) { run("/usr/bin/defaults", ["write", "com.apple.screencapture", "location", value]) }
  func clear() { run("/usr/bin/defaults", ["delete", "com.apple.screencapture", "location"]) }
  func applyChange() { run("/usr/bin/killall", ["SystemUIServer"]) }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
  private var statusItem: NSStatusItem!
  private var watcher: Watcher?
  private var uploader: Uploader!
  private var dirManager: ScreenshotDirManager!
  private var paused = false
  private let menu = NSMenu()
  private let folder = NSHomeDirectory() + "/Pictures/shotsync"

  func applicationDidFinishLaunching(_ n: Notification) {
    let support = NSHomeDirectory() + "/Library/Application Support/shotsync"
    try? FileManager.default.createDirectory(atPath: support, withIntermediateDirectories: true)
    try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
    uploader = Uploader(
      queue: UploadQueue(fileURL: URL(fileURLWithPath: support + "/queue.json")),
      stateURL: URL(fileURLWithPath: support + "/multipart-state.json"))

    dirManager = ScreenshotDirManager(
      backend: SystemDefaultsBackend(),
      savedOriginal: { Config.originalScreenshotDir },
      setSavedOriginal: { Config.originalScreenshotDir = $0 })

    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    menu.delegate = self
    statusItem.menu = menu
    refreshMenu()

    if Config.baseURL == nil || Config.token() == nil { promptSettings() }
    confirmRedirectIfNeeded()
    startWatching()
    uploader.drainQueue()
  }

  private func startWatching() {
    watcher?.stop()
    watcher = Watcher(folder: folder) { [weak self] path in
      guard let self, !self.paused else { return }
      self.uploader.enqueueAndUpload(path)
    }
    watcher?.start()
  }

  // Only capture the original location when we have NOT already redirected
  // (guards against re-capturing the shotsync folder as "original" on relaunch).
  private func confirmRedirectIfNeeded() {
    guard Config.originalScreenshotDir == nil else { return }
    let a = NSAlert()
    a.messageText = "Redirect screenshots to shotsync?"
    a.informativeText = "shotsync will set the system screenshot location to ~/Pictures/shotsync so only screenshots are synced. It restores your original location when you quit or choose “Restore default screenshot location”."
    a.addButton(withTitle: "Redirect"); a.addButton(withTitle: "Not now")
    if a.runModal() == .alertFirstButtonReturn { dirManager.redirect(to: folder) }
  }

  private func promptSettings() {
    let a = NSAlert(); a.messageText = "shotsync settings"
    a.informativeText = "Worker base URL and access token"
    let stack = NSStackView(frame: NSRect(x: 0, y: 0, width: 320, height: 54))
    stack.orientation = .vertical
    let urlField = NSTextField(string: Config.baseURL?.absoluteString ?? "https://")
    let tokenField = NSSecureTextField(string: Config.token() ?? "")
    urlField.frame = NSRect(x: 0, y: 28, width: 320, height: 22)
    tokenField.frame = NSRect(x: 0, y: 0, width: 320, height: 22)
    stack.addArrangedSubview(urlField); stack.addArrangedSubview(tokenField)
    a.accessoryView = stack
    a.addButton(withTitle: "Save"); a.addButton(withTitle: "Cancel")
    if a.runModal() == .alertFirstButtonReturn {
      if let u = URL(string: urlField.stringValue) { Config.baseURL = u }
      Config.setToken(tokenField.stringValue)
    }
  }

  // MARK: - Menu

  /// The screenshot location can be changed outside this app (System Settings,
  /// another tool), so rebuild on every open instead of caching.
  func menuNeedsUpdate(_ menu: NSMenu) { refreshMenu() }

  /// Sampled fresh on every call rather than cached: the whole point of the
  /// status is to reflect the system right now, and the read is a sub-millisecond
  /// `defaults` call. A cached copy could claim "✓ syncing" after the location
  /// changed underneath us.
  private func currentHealth() -> SyncHealth {
    // A base URL without a token can't upload, so treat it as unconfigured.
    let configured = Config.baseURL != nil && Config.token() != nil
    return SyncHealth(
      screenshotLocation: dirManager.currentLocation(),
      expectedLocation: folder,
      workerHost: configured ? Config.baseURL?.host : nil)
  }

  private func refreshMenu() {
    let health = currentHealth()
    statusItem.button?.title = paused ? "⏸" : "●"
    menu.removeAllItems()
    add(paused ? "Paused" : "Syncing", nil)
    add(HelpContent.menuLocationLine(for: health), nil)
    menu.addItem(.separator())
    // The gallery item doubles as the URL display; with no Worker configured
    // it becomes a shortcut into Settings.
    add(HelpContent.menuGalleryLine(for: health),
        health.hasWorker ? #selector(openGallery) : #selector(settings))
    // Disabled without a Worker — there is no link to put on the clipboard.
    add("Copy gallery link", health.hasWorker ? #selector(copyLink) : nil)
    menu.addItem(.separator())
    add("How to use…", #selector(showHelp))
    add(paused ? "Resume" : "Pause", #selector(togglePause))
    menu.addItem(.separator())
    add("Settings…", #selector(settings))
    add("Restore default screenshot location", #selector(restoreDir))
    add("Quit shotsync", #selector(quit), key: "q")
  }

  private func add(_ title: String, _ action: Selector?, key: String = "") {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
    if action != nil { item.target = self }
    menu.addItem(item)
  }

  // MARK: - Actions

  @objc private func showHelp() {
    let health = currentHealth()
    let a = NSAlert()
    a.messageText = HelpContent.title
    a.informativeText = HelpContent.subtitle
    a.accessoryView = monospacedLabel(HelpContent.body(for: health))

    // Buttons come from HelpContent in display order, so a response index maps
    // straight back onto its action — nothing here has to stay in sync by hand.
    let actions = HelpContent.buttonOrder(for: health)
    for action in actions { a.addButton(withTitle: HelpContent.buttonTitle(for: action)) }
    a.addButton(withTitle: "Done")

    let clicked = a.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
    if actions.indices.contains(clicked) { execute(actions[clicked]) }  // else: Done
  }

  private func execute(_ action: HelpAction) {
    switch action {
    case .openGallery: openGallery()
    case .redirectNow: dirManager.redirect(to: folder)
    case .openSettings: promptSettings()
    }
  }

  /// The panel body relies on column alignment, so it needs a monospaced font
  /// rather than the alert's proportional informativeText.
  private func monospacedLabel(_ text: String) -> NSView {
    let font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    let attributed = NSAttributedString(string: text, attributes: [.font: font])
    // Measure against a width no line reaches, so nothing wraps.
    let bounds = attributed.boundingRect(
      with: NSSize(width: 900, height: 0),
      options: [.usesLineFragmentOrigin, .usesFontLeading])
    let field = NSTextField(labelWithAttributedString: attributed)
    field.usesSingleLineMode = false
    field.maximumNumberOfLines = 0
    field.frame = NSRect(x: 0, y: 0, width: ceil(bounds.width), height: ceil(bounds.height))
    return field
  }

  @objc private func togglePause() { paused.toggle(); refreshMenu() }
  @objc private func openGallery() { if let u = Config.baseURL { NSWorkspace.shared.open(u) } }
  @objc private func copyLink() {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(Config.baseURL?.absoluteString ?? "", forType: .string)
  }
  @objc private func settings() { promptSettings() }
  @objc private func restoreDir() { dirManager.restore() }
  @objc private func quit() { dirManager.restore(); NSApp.terminate(nil) }
}
