/* Pure, QML-compatible parsing and command planning. */

var MODES = ["warp", "doh", "warp+doh", "dot", "warp+dot", "proxy", "tunnel_only"]
var PROTOCOLS = ["MASQUE", "WireGuard"]
var FAMILIES = ["off", "malware", "full"]

function string(value) { return String(value === undefined || value === null ? "" : value) }

function clean(value) {
  return string(value).replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, "").trim()
}

function compact(value) { return clean(value).replace(/\s+/g, " ") }

function canonical(value) { return compact(value).toLowerCase() }

function termsRequired(value) {
  return canonical(value) === "please accept the warp terms of service by running this command in a tty or by passing the --accept-tos flag."
}

function escapeRegExp(value) { return string(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }

function label(raw, names) {
  return labelResult(raw, names).value
}

function labelResult(raw, names) {
  var lines = clean(raw).split(/\r?\n/)
  for (var i = 0; i < lines.length; i++) {
    for (var j = 0; j < names.length; j++) {
      var match = lines[i].match(new RegExp("^\\s*(?:\\([^\\r\\n)]*\\)\\s*)?(?:[-*]\\s*)?" + escapeRegExp(names[j]) + "\\s*:\\s*(.*?)\\s*$", "i"))
      if (match) return { found: true, value: match[1] }
    }
  }
  return { found: false, value: "" }
}

function statusLabel(raw) {
  var lines = clean(raw).split(/\r?\n/)
  for (var i = 0; i < lines.length; i++) {
    var match = lines[i].match(/^\s*Status(?:\s+update)?\s*:\s*(.*?)\s*$/i)
    if (match) return match[1]
  }
  return ""
}

function parseStatus(stdout, stderr, exitCode) {
  var out = clean(stdout)
  var err = clean(stderr)
  var all = canonical(out + "\n" + err)

  // The daemon's missing Unix socket also says "No such file or directory".
  // Classify daemon errors before executable-not-found errors.
  if (/unable to connect to (?:the )?cloudflarewarp daemon|failed to connect to (?:the )?warp service|could not connect to (?:the )?warp service|warp[- ]svc.*not running|daemon.*not running/.test(all))
    return { state: "daemon-down", connected: false, error: "WARP service is not running" }

  if (Number(exitCode) === 127 || /(?:warp-cli: )?command not found|env:.*warp-cli.*no such file/.test(all))
    return { state: "missing-client", connected: false, error: "warp-cli is not installed" }

  // 2026.6 gates every read behind this exact message before the terms have
  // been accepted. Keep the signal separate so registration can require a
  // confirmation and a managed-enrollment preflight before it mutates state.
  if (termsRequired(out + "\n" + err))
    return { state: "unregistered", connected: false, error: "This device is not registered", termsRequired: true }

  if (/registration missing|missing registration|not registered|device.*unregistered|no registration/.test(all))
    return { state: "unregistered", connected: false, error: "This device is not registered" }

  var rawStatus = statusLabel(out)
  var status = canonical(rawStatus)

  // A no-network reason can accompany an otherwise ordinary-looking status
  // label. Treat it as the authoritative failure before accepting a terminal
  // Connected/Disconnected word, so the UI never hides an offline condition.
  if (/no network|\bnonetwork\b|network unavailable|network is offline|offline/.test(status + " " + all))
    return { state: "no-network", connected: false, error: "Network is unavailable" }

  // Normal connection labels are authoritative only when warp-cli itself
  // succeeds. A newer failure may leave a plausible label on stdout while
  // returning a nonzero code and diagnostics on stderr; fail closed.
  if (Number(exitCode) !== 0)
    return { state: "error", connected: false, error: "WARP status command failed" }

  if (/^connected(?:\b|$)/.test(status))
    return { state: "connected", connected: true, error: "" }
  if (/^(?:disconnected|stopped|inactive)(?:\b|$)/.test(status))
    return { state: "disconnected", connected: false, error: "" }
  if (/^(?:connecting|reconnecting|disconnecting)(?:\b|$)/.test(status))
    return { state: "connecting", connected: false, error: "" }
  if (/unable|failed|error|dns|tunnel/.test(status))
    return { state: "error", connected: false, error: "WARP reported a connection error" }
  return { state: "unknown", connected: false, error: "Unrecognized warp-cli status" }
}

function parseRegistration(stdout, stderr, exitCode) {
  var out = clean(stdout)
  var combined = out + "\n" + clean(stderr)
  var all = canonical(combined)
  if (termsRequired(combined))
    return { known: true, registered: false, managed: false, termsRequired: true }

  var organization = labelResult(out, ["Organization", "Team name"])
  var registrationType = labelResult(out, ["Registration type", "Account type", "Type"])
  var type = enumKey(registrationType.value)
  var consumer = /^(?:consumer|free|limited|unlimited|notmanaged)$/.test(type)
  var recognized = organization.found || registrationType.found
  var managed = (organization.found && !noneValue(organization.value))
    // New account types must remain read-only until deliberately classified.
    || (registrationType.found && !consumer)
  var missing = /registration missing|missing registration|not registered|no registration/.test(all)
  return {
    known: missing || (Number(exitCode) === 0 && recognized),
    registered: Number(exitCode) === 0 && recognized && !missing,
    managed: managed
  }
}

function enumKey(value) { return canonical(value).replace(/[^a-z0-9]/g, "") }

function normalizeMode(value) {
  var aliases = {
    warp: "warp",
    doh: "doh", dnsoverhttps: "doh",
    warpdoh: "warp+doh", warpwithdnsoverhttps: "warp+doh",
    dot: "dot", dnsovertls: "dot",
    warpdot: "warp+dot", warpwithdnsovertls: "warp+dot",
    proxy: "proxy", localproxy: "proxy", warpproxy: "proxy",
    tunnelonly: "tunnel_only", trafficonly: "tunnel_only"
  }
  var key = enumKey(value)
  if (/^warpproxy(?:onport\d+)?$/.test(key)) return "proxy"
  return aliases[key] || "unknown"
}

function normalizeProtocol(value) {
  var key = enumKey(value)
  if (key === "masque") return "MASQUE"
  if (key === "wireguard") return "WireGuard"
  return "unknown"
}

function normalizeFamilies(value) {
  var key = enumKey(value)
  if (key === "full" || key === "malwareandadultcontent" || key === "malwareadultcontent"
      || key === "blockmalwareandadultcontent" || key === "blockmalwareadultcontent") return "full"
  if (key === "malware" || key === "blockmalware") return "malware"
  if (key === "off" || key === "none" || key === "disabled") return "off"
  return "unknown"
}

function normalizeFamiliesResolver(value) {
  // Current Linux settings output reports the selected Families profile via
  // its resolver hostname. Require the hostname to be the complete first
  // token so lookalike/custom domains cannot enable configuration by mistake.
  var match = compact(value).match(/^([^\s@]+)(?:\s+@\s+.+)?$/)
  if (!match) return "unknown"
  var hostname = canonical(match[1])
  if (hostname === "cloudflare-dns.com" || hostname === "one.one.one.one") return "off"
  if (hostname === "security.cloudflare-dns.com") return "malware"
  if (hostname === "family.cloudflare-dns.com") return "full"
  return "unknown"
}

function noneValue(value) {
  return /^(?:|none|null|unset|not ?set|not configured|<none>|<not set>)$/i.test(compact(value))
}

function parseSettings(raw, exitCode) {
  var out = clean(raw)
  var modeResult = labelResult(out, ["Mode", "Service mode"])
  var protocolResult = labelResult(out, ["Tunnel protocol", "WARP tunnel protocol", "Protocol"])
  var familiesResult = labelResult(out, ["Families mode", "Families", "DNS families filtering"])
  var resolverResult = labelResult(out, ["Resolve via"])
  var lockResult = labelResult(out, ["Switch Locked"])
  var organizationResult = labelResult(out, ["Organization", "Team name"])
  var switchLocked = canonical(lockResult.value)
  var recognized = modeResult.found || protocolResult.found || familiesResult.found
    || resolverResult.found || lockResult.found || organizationResult.found
  return {
    known: (exitCode === undefined || Number(exitCode) === 0) && recognized,
    mode: normalizeMode(modeResult.value),
    protocol: normalizeProtocol(protocolResult.value),
    families: familiesResult.found
      ? normalizeFamilies(familiesResult.value)
      : normalizeFamiliesResolver(resolverResult.value),
    lockedKnown: lockResult.found && /^(?:true|false|yes|no|on|off|locked|unlocked)$/.test(switchLocked),
    locked: /^(?:true|yes|on|locked)$/.test(switchLocked),
    organizationKnown: organizationResult.found,
    organizationConfigured: organizationResult.found && !noneValue(organizationResult.value)
  }
}

function actionError(kind, stdout, stderr, exitCode) {
  var all = canonical(string(stdout) + "\n" + string(stderr))
  if (kind === "register" && registrationAlreadyExists(stdout, stderr, exitCode))
    return "WARP is already registered"
  if (kind === "start-daemon" && /not\s*authorized|authentication.*(?:cancel|fail)|dismissed|cancelled|canceled/.test(all))
    return "Administrator authentication was canceled"
  if (/not\s*authorized|not allowed/.test(all))
    return "Action is not allowed"
  if (/permission denied|access denied|not permitted/.test(all))
    return "Permission was denied"
  if (/locked|managed by|policy/.test(all))
    return "Configuration is managed by your organization"
  if (/no network|network unavailable|offline/.test(all))
    return "Network is unavailable"
  if (/registration missing|missing registration|not registered/.test(all))
    return "This device is not registered"
  return "WARP command failed" + (Number(exitCode) ? " (exit " + Number(exitCode) + ")" : "")
}

function registrationAlreadyExists(stdout, stderr, exitCode) {
  if (Number(exitCode) === 0) return false
  var all = canonical(string(stdout) + "\n" + string(stderr))
  // Current clients append a quoted remediation command. Match that advice by
  // shape instead of carrying or exposing the destructive command itself.
  // Anchoring the complete diagnostic keeps unrelated appended output from
  // being mistaken for a successful, pre-existing registration.
  return /^(?:error:\s*)?old registration is still around\.(?:\s+try running:\s+"[^"\r\n]+"(?:\s+and re-run this command)?\.?)?$/.test(all)
}

function transitionResult(target, state) {
  if (target !== "connected" && target !== "disconnected")
    return { done: true, success: false, error: "WARP operation failed" }
  if (state === target) return { done: true, success: true, error: "" }
  if (state === "no-network") return { done: true, success: false, error: "Network is unavailable" }
  if (state === "daemon-down") return { done: true, success: false, error: "WARP service is not running" }
  if (state === "unregistered") return { done: true, success: false, error: "This device is not registered" }
  if (state === "error" || state === "unknown")
    return { done: true, success: false, error: "WARP reported a connection error" }
  return { done: false, success: false, error: "" }
}

function capabilities(model) {
  model = model || {}
  var state = string(model.state)
  var busy = model.busy === true
  var installed = state !== "missing-client"
  var daemonRunning = installed && state !== "daemon-down"
  var operational = daemonRunning && model.registered === true
  var settled = state === "connected" || state === "disconnected"
  var connected = model.connected === true
  return {
    canConnect: operational && state === "disconnected" && !connected && !busy,
    canDisconnect: operational && state === "connected" && connected && model.locked !== true && !busy,
    canConfigure: operational && model.registrationKnown === true && model.settingsKnown === true
      && model.managed !== true && settled && !busy,
    canRegister: state === "unregistered"
      && model.managed !== true
      && (model.consumerRegistrationAllowed === true || model.termsRequired === true) && !busy,
    canStartDaemon: state === "daemon-down" && !busy
  }
}

function reduceSettings(current, result) {
  current = current || {}
  result = result || {}
  var complete = result.known === true && result.mode !== "unknown" && result.protocol !== "unknown"
    && result.families !== "unknown" && result.lockedKnown === true
  return {
    settingsKnown: complete,
    mode: result.known && result.mode !== "unknown" ? result.mode : string(current.mode || "unknown"),
    protocol: result.known && result.protocol !== "unknown" ? result.protocol : string(current.protocol || "unknown"),
    families: result.known && result.families !== "unknown" ? result.families : string(current.families || "unknown"),
    locked: result.known && result.lockedKnown ? result.locked === true : current.locked === true,
    managed: current.managed === true || (result.known === true && result.organizationConfigured === true)
  }
}

function registrationPreflight(settings) {
  settings = settings || {}
  var known = settings.known === true && settings.organizationKnown === true
  return {
    known: known,
    allowed: known && settings.organizationConfigured !== true,
    managed: known && settings.organizationConfigured === true
  }
}

function parseMdmPreflight(stdout, stderr, exitCode) {
  var blocked = { known: false, allowed: false, managed: false }
  if (Number(exitCode) !== 0 || clean(stderr) !== "") return blocked

  var value
  try {
    value = JSON.parse(clean(stdout))
  } catch (error) {
    return blocked
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) return blocked
  var keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== "active" || keys[1] !== "available"
      || !Array.isArray(value.available)) return blocked

  var managed = value.active !== null || value.available.length !== 0
  return { known: true, allowed: !managed, managed: managed }
}

function warpBase(termsAccepted) {
  var args = ["env", "LC_ALL=C", "LANG=C", "NO_COLOR=1", "TERM=dumb", "PAGER=cat",
    "warp-cli", "--no-ansi", "--no-paginate"]
  if (termsAccepted === true) args.push("--accept-tos")
  return args
}

function command(kind, value, termsAccepted) {
  var args = []
  if (kind === "status") args = ["status"]
  else if (kind === "registration") args = ["registration", "show"]
  else if (kind === "settings") args = ["settings", "list"]
  else if (kind === "registration-preflight")
    return ["env", "LC_ALL=C", "LANG=C", "NO_COLOR=1", "TERM=dumb", "PAGER=cat",
      "warp-cli", "--json", "--no-ansi", "--no-paginate", "--accept-tos", "mdm", "get-configs"]
  else if (kind === "connect") args = ["connect"]
  else if (kind === "disconnect") args = ["disconnect"]
  else if (kind === "register") return warpBase(true).concat(["registration", "new"])
  else if (kind === "mode" && MODES.indexOf(value) !== -1) args = ["mode", value]
  else if (kind === "protocol" && PROTOCOLS.indexOf(value) !== -1) args = ["tunnel", "protocol", "set", value]
  else if (kind === "families" && FAMILIES.indexOf(value) !== -1) args = ["dns", "families", value]
  else if (kind === "start-daemon") return ["pkexec", "systemctl", "enable", "--now", "warp-svc.service"]
  else return []
  return warpBase(termsAccepted).concat(args)
}

function publicError(value) {
  var text = compact(value)
  if (text === "") return ""
  var allowed = [
    "warp-cli is not installed", "WARP service is not running", "This device is not registered",
    "Network is unavailable", "WARP reported a connection error", "WARP status command failed",
    "Unrecognized warp-cli status", "WARP status check timed out", "WARP action timed out",
    "Timed out waiting for WARP state", "Configuration is managed by your organization",
    "Connection is locked by your organization", "Local proxy requires MASQUE",
    "WireGuard is unavailable in Local proxy mode", "Consumer registration is unavailable",
    "WARP is already registered",
    "Could not verify MDM configuration",
    "Administrator authentication was canceled", "Action is not allowed", "Permission was denied",
    "Unsupported WARP action", "WARP operation failed"
  ]
  for (var i = 0; i < allowed.length; i++) if (text === allowed[i]) return text
  if (/^WARP command failed \(exit [0-9]+\)$/.test(text)) return text
  return "WARP operation failed"
}

function enumOr(value, allowed, fallback) {
  value = string(value)
  return allowed.indexOf(value) !== -1 ? value : fallback
}

function publicStatus(model) {
  model = model || {}
  var state = enumOr(model.state, ["checking", "connected", "disconnected", "connecting", "missing-client", "daemon-down", "unregistered", "no-network", "error", "unknown"], "unknown")
  return {
    state: state,
    connected: state === "connected" && model.connected === true,
    mode: enumOr(model.mode, MODES, "unknown"),
    protocol: enumOr(model.protocol, PROTOCOLS, "unknown"),
    families: enumOr(model.families, FAMILIES, "unknown"),
    managed: model.managed === true,
    locked: model.locked === true,
    busy: model.busy === true,
    error: publicError(model.error)
  }
}

if (typeof module !== "undefined") module.exports = {
  MODES: MODES, PROTOCOLS: PROTOCOLS, FAMILIES: FAMILIES,
  clean: clean, label: label, termsRequired: termsRequired,
  parseStatus: parseStatus, parseRegistration: parseRegistration,
  parseSettings: parseSettings,
  normalizeMode: normalizeMode, normalizeProtocol: normalizeProtocol, normalizeFamilies: normalizeFamilies,
  normalizeFamiliesResolver: normalizeFamiliesResolver,
  command: command, actionError: actionError, registrationAlreadyExists: registrationAlreadyExists,
  transitionResult: transitionResult, capabilities: capabilities,
  reduceSettings: reduceSettings, registrationPreflight: registrationPreflight,
  parseMdmPreflight: parseMdmPreflight,
  publicError: publicError, publicStatus: publicStatus
}
