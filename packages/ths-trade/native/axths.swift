// AX bridge for the 同花顺 Mac client.
//
// The client ships no AppleScript dictionary, so the Accessibility API is the
// only supported way in. We drive it through AXUIElement rather than System
// Events for one reason that matters with real money: `set` writes a field's
// AXValue directly and `press` invokes AXPress on a specific element, so a
// misplaced focus cannot send an order's digits to the wrong control the way
// synthetic keystrokes can.
//
// Commands (all output JSON on stdout, errors as {"error": "..."} + exit 1):
//   axths apps                       list candidate 同花顺 processes
//   axths dump [--pid N] [--depth D] [--window W] dump the AX tree
//   axths read <ref>                 read one element's attributes
//   axths set <ref> <value>          set AXValue (text fields)
//   axths press <ref>                invoke AXPress (buttons)
//
// A <ref> is the stable path printed by `dump`, e.g. "w0/g2/t1": window 0,
// child group 2, child text field 1. Paths are positional, so every command
// re-resolves them against the live tree and fails loudly when the shape moved
// rather than acting on whatever now sits at that index.

import ApplicationServices
import AppKit
import Foundation

// The client renames its bundle id across builds (macstock / macstockPro seen
// on the same install after a self-update), so match the vendor prefix and
// keep the name only as a fallback — the WebKit helper processes it spawns
// carry the same localized name and must never be picked as the target.
let THS_BUNDLE_PREFIX = "cn.com.10jqka."

// MARK: - Output

func fail(_ message: String) -> Never {
  let payload = ["error": message]
  if let data = try? JSONSerialization.data(withJSONObject: payload),
     let text = String(data: data, encoding: .utf8) {
    FileHandle.standardError.write(Data((text + "\n").utf8))
  }
  exit(1)
}

func emit(_ value: Any) {
  guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .withoutEscapingSlashes]),
        let text = String(data: data, encoding: .utf8) else {
    fail("could not serialize result")
  }
  print(text)
}

// MARK: - AX helpers

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
  return value
}

func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
  guard let value = attribute(element, name) else { return nil }
  if let text = value as? String { return text }
  if CFGetTypeID(value) == AXValueGetTypeID() { return describeAXValue(value as! AXValue) }
  if let number = value as? NSNumber { return number.stringValue }
  return nil
}

func describeAXValue(_ value: AXValue) -> String? {
  switch AXValueGetType(value) {
  case .cgPoint:
    var point = CGPoint.zero
    AXValueGetValue(value, .cgPoint, &point)
    return "\(Int(point.x)),\(Int(point.y))"
  case .cgSize:
    var size = CGSize.zero
    AXValueGetValue(value, .cgSize, &size)
    return "\(Int(size.width))x\(Int(size.height))"
  default:
    return nil
  }
}

func children(_ element: AXUIElement) -> [AXUIElement] {
  guard let value = attribute(element, kAXChildrenAttribute as String) else { return [] }
  return (value as? [AXUIElement]) ?? []
}

func actions(_ element: AXUIElement) -> [String] {
  var names: CFArray?
  guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
  return (names as? [String]) ?? []
}

/// One-letter tag per role, so a path stays short and still says what it points at.
func tag(for role: String) -> String {
  switch role {
  case kAXWindowRole: return "w"
  case kAXButtonRole: return "b"
  case kAXTextFieldRole: return "t"
  case kAXStaticTextRole: return "s"
  case kAXTableRole, kAXOutlineRole: return "tbl"
  case kAXRowRole: return "r"
  case kAXCellRole: return "c"
  case kAXCheckBoxRole: return "x"
  case kAXRadioButtonRole: return "rb"
  case kAXPopUpButtonRole, kAXComboBoxRole: return "p"
  case kAXTabGroupRole: return "tab"
  case kAXScrollAreaRole: return "sc"
  case kAXListRole: return "l"
  default: return "g"
  }
}

func describe(_ element: AXUIElement, path: String) -> [String: Any] {
  var node: [String: Any] = ["ref": path]
  let role = stringAttribute(element, kAXRoleAttribute as String) ?? "?"
  node["role"] = role
  for (key, attr) in [
    ("subrole", kAXSubroleAttribute as String),
    ("title", kAXTitleAttribute as String),
    ("desc", kAXDescriptionAttribute as String),
    ("value", kAXValueAttribute as String),
    ("placeholder", kAXPlaceholderValueAttribute as String),
    ("help", kAXHelpAttribute as String),
    ("id", kAXIdentifierAttribute as String),
    ("pos", kAXPositionAttribute as String),
    ("size", kAXSizeAttribute as String),
  ] {
    if let text = stringAttribute(element, attr), !text.isEmpty { node[key] = text }
  }
  if let enabled = attribute(element, kAXEnabledAttribute as String) as? Bool, !enabled {
    node["enabled"] = false
  }
  let acts = actions(element)
  if !acts.isEmpty { node["actions"] = acts }
  return node
}

/// Depth-first dump. Indices restart per role tag at each level, which keeps a
/// path readable ("w0/g3/t1") and stable against unrelated siblings appearing.
func walk(_ element: AXUIElement, path: String, depth: Int, limit: Int, into nodes: inout [[String: Any]]) {
  var node = describe(element, path: path)
  let kids = children(element)
  if !kids.isEmpty { node["children"] = kids.count }
  nodes.append(node)
  guard depth < limit else { return }
  var counters: [String: Int] = [:]
  for kid in kids {
    let role = stringAttribute(kid, kAXRoleAttribute as String) ?? "?"
    let t = tag(for: role)
    let index = counters[t] ?? 0
    counters[t] = index + 1
    walk(kid, path: path.isEmpty ? "\(t)\(index)" : "\(path)/\(t)\(index)", depth: depth + 1, limit: limit, into: &nodes)
  }
}

/// Resolves a positional path against the live tree.
func resolve(_ root: AXUIElement, path: String) -> AXUIElement? {
  var current = root
  for segment in path.split(separator: "/") {
    let text = String(segment)
    let digits = text.drop { !$0.isNumber }
    guard let index = Int(digits) else { return nil }
    let wanted = String(text.prefix(text.count - digits.count))
    var seen = 0
    var match: AXUIElement?
    for kid in children(current) {
      let role = stringAttribute(kid, kAXRoleAttribute as String) ?? "?"
      guard tag(for: role) == wanted else { continue }
      if seen == index { match = kid; break }
      seen += 1
    }
    guard let found = match else { return nil }
    current = found
  }
  return current
}

// MARK: - Keyboard input

// Writing AXValue is accepted by this client's text fields but does NOT run
// its own text-changed handling: the field displays the code while the app
// still believes it is empty. Real key events are therefore the only way to
// make it look the quote up — and they go through CGEventPostToPid so they
// land in 同花顺's queue rather than the global stream, where whatever the
// user focuses mid-order would swallow them.

let keySource = CGEventSource(stateID: .privateState)

/// Posts one character as a key down/up pair carrying its unicode payload.
func postCharacter(_ character: Character, to pid: pid_t) {
  let utf16 = Array(String(character).utf16)
  for isDown in [true, false] {
    guard let event = CGEvent(keyboardEventSource: keySource, virtualKey: 0, keyDown: isDown) else { continue }
    event.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
    event.postToPid(pid)
  }
  // Clients that filter fast input drop characters without this gap.
  usleep(25_000)
}

/// Posts a virtual key with optional modifiers (⌘A, ⌫, ⇥, ↩).
func postKey(_ keyCode: CGKeyCode, flags: CGEventFlags = [], to pid: pid_t) {
  for isDown in [true, false] {
    guard let event = CGEvent(keyboardEventSource: keySource, virtualKey: keyCode, keyDown: isDown) else { continue }
    event.flags = flags
    event.postToPid(pid)
  }
  usleep(25_000)
}

let KEY_A: CGKeyCode = 0x00
let KEY_DELETE: CGKeyCode = 0x33

func focus(_ element: AXUIElement) -> Bool {
  AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
}

// MARK: - Process lookup

func thsApplications() -> [NSRunningApplication] {
  NSWorkspace.shared.runningApplications.filter { app in
    let bundleId = app.bundleIdentifier ?? ""
    if bundleId.hasPrefix(THS_BUNDLE_PREFIX) { return true }
    // Helpers are separate processes under Apple's own bundle ids.
    if bundleId.hasPrefix("com.apple.") { return false }
    return (app.localizedName ?? "").contains("同花顺")
  }
}

func targetApplication(pid explicit: pid_t?) -> (pid_t, AXUIElement) {
  if let pid = explicit { return (pid, AXUIElementCreateApplication(pid)) }
  guard let app = thsApplications().first else {
    fail("同花顺 is not running (looked for bundle ids under \(THS_BUNDLE_PREFIX)); launch and log in first")
  }
  return (app.processIdentifier, AXUIElementCreateApplication(app.processIdentifier))
}

// MARK: - Commands

var args = Array(CommandLine.arguments.dropFirst())
guard let command = args.first else {
  fail("usage: axths apps | dump | read <ref> | set <ref> <value> | focus <ref> | type <ref> <text> [--clear] | press <ref>")
}
args.removeFirst()

func option(_ name: String) -> String? {
  guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
  return args[index + 1]
}

if !AXIsProcessTrusted() {
  fail("this process has no Accessibility permission; grant it in 系统设置 → 隐私与安全性 → 辅助功能")
}

switch command {
case "apps":
  emit(thsApplications().map { app in
    [
      "pid": app.processIdentifier,
      "name": app.localizedName ?? "",
      "bundleId": app.bundleIdentifier ?? "",
      "active": app.isActive,
    ] as [String: Any]
  })

case "dump":
  let (pid, appElement) = targetApplication(pid: option("--pid").flatMap { pid_t($0) })
  let limit = Int(option("--depth") ?? "12") ?? 12
  let windows = (attribute(appElement, kAXWindowsAttribute as String) as? [AXUIElement]) ?? []
  var nodes: [[String: Any]] = []
  if let wanted = option("--window").flatMap({ Int($0) }) {
    guard wanted < windows.count else { fail("window \(wanted) out of range (\(windows.count) windows)") }
    walk(windows[wanted], path: "w\(wanted)", depth: 0, limit: limit, into: &nodes)
  } else {
    for (index, window) in windows.enumerated() {
      walk(window, path: "w\(index)", depth: 0, limit: limit, into: &nodes)
    }
  }
  emit(["pid": pid, "windows": windows.count, "nodes": nodes] as [String: Any])

case "read":
  guard let ref = args.first else { fail("read needs a <ref>") }
  let (_, appElement) = targetApplication(pid: option("--pid").flatMap { pid_t($0) })
  guard let element = resolve(appElement, path: ref) else { fail("ref \(ref) does not resolve; re-dump the tree") }
  emit(describe(element, path: ref))

case "set":
  guard args.count >= 2 else { fail("set needs <ref> <value>") }
  let ref = args[0]
  let value = args[1]
  let (_, appElement) = targetApplication(pid: option("--pid").flatMap { pid_t($0) })
  guard let element = resolve(appElement, path: ref) else { fail("ref \(ref) does not resolve; re-dump the tree") }
  let status = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
  guard status == .success else { fail("set failed on \(ref): AXError \(status.rawValue)") }
  // Read back: a field that silently refused the write must not look like success.
  emit(["ref": ref, "wrote": value, "readback": stringAttribute(element, kAXValueAttribute as String) ?? ""])

case "focus":
  guard let ref = args.first else { fail("focus needs a <ref>") }
  let (_, appElement) = targetApplication(pid: option("--pid").flatMap { pid_t($0) })
  guard let element = resolve(appElement, path: ref) else { fail("ref \(ref) does not resolve; re-dump the tree") }
  guard focus(element) else { fail("could not focus \(ref)") }
  let focused = (attribute(element, kAXFocusedAttribute as String) as? Bool) ?? false
  emit(["ref": ref, "focused": focused])

case "type":
  guard args.count >= 2 else { fail("type needs <ref> <text>") }
  let ref = args[0]
  let text = args[1]
  let (pid, appElement) = targetApplication(pid: option("--pid").flatMap { pid_t($0) })
  guard let element = resolve(appElement, path: ref) else { fail("ref \(ref) does not resolve; re-dump the tree") }
  guard focus(element) else { fail("could not focus \(ref); refusing to type into an unknown target") }
  usleep(150_000)
  // Refuse to type unless the field really took focus: keys go to whatever is
  // focused inside the app, so an unfocused target means typing elsewhere.
  guard (attribute(element, kAXFocusedAttribute as String) as? Bool) ?? false else {
    fail("\(ref) did not take focus; refusing to type")
  }
  if args.contains("--clear") {
    postKey(KEY_A, flags: .maskCommand, to: pid)
    postKey(KEY_DELETE, to: pid)
  }
  for character in text { postCharacter(character, to: pid) }
  usleep(300_000)
  let readback = stringAttribute(element, kAXValueAttribute as String) ?? ""
  emit([
    "ref": ref,
    "typed": text,
    "readback": readback,
    // The caller must still confirm the APP reacted (name echo, 可买, 参考金额);
    // a matching readback only proves the characters landed in the field.
    "matches": readback == text,
  ])

case "press":
  guard let ref = args.first else { fail("press needs a <ref>") }
  let (_, appElement) = targetApplication(pid: option("--pid").flatMap { pid_t($0) })
  guard let element = resolve(appElement, path: ref) else { fail("ref \(ref) does not resolve; re-dump the tree") }
  guard actions(element).contains(kAXPressAction as String) else {
    fail("\(ref) has no AXPress action; it is not a button")
  }
  let status = AXUIElementPerformAction(element, kAXPressAction as CFString)
  guard status == .success else { fail("press failed on \(ref): AXError \(status.rawValue)") }
  emit(["ref": ref, "pressed": true])

default:
  fail("unknown command \(command)")
}
