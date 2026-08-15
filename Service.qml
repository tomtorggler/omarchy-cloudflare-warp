import QtQuick
import Quickshell.Io
import "Model.js" as Model

Item {
  id: root

  property var settings: ({})
  // The panel briefly holds periodic polling while a confirmation is open so
  // a timer tick cannot invalidate an action between review and acceptance.
  property bool pollingPaused: false
  // The host persists this non-secret boolean in the widget entry after the
  // user explicitly confirms the Terms. The session flag closes the small
  // gap before that settings update is observed or the plugin is reloaded.
  property bool _sessionTermsAccepted: false
  readonly property bool termsAccepted: _sessionTermsAccepted
    || (settings && settings.termsAccepted === true)

  // Confirmed client state. Pending intent is deliberately never folded into
  // `connected`, so the bar and IPC cannot claim a connection too early.
  property string state: "checking"
  property bool connected: false
  property bool registered: false
  property bool registrationKnown: false
  property bool settingsKnown: false
  property bool managed: false
  property bool locked: false // Cloudflare's Switch Locked policy.
  property string mode: "unknown"
  property string protocol: "unknown"
  property string families: "unknown"
  property bool consumerRegistrationAllowed: false
  property bool managedEnrollmentConfigured: false
  // Set only for warp-cli's exact pre-registration Terms prompt. The panel
  // may offer confirmation, but registration still performs a managed-org
  // preflight before creating anything.
  property bool termsRequired: false

  property bool refreshing: false
  property bool actionBusy: false
  property string actionStatus: ""
  property string statusError: ""
  property string actionError: ""

  readonly property bool availabilityFailure: ["missing-client", "daemon-down", "no-network", "error", "unknown"].indexOf(state) !== -1
  readonly property string lastError: availabilityFailure && statusError !== "" ? statusError : (actionError || statusError)
  readonly property bool busy: refreshing || actionBusy
  readonly property bool installed: state !== "missing-client"
  readonly property bool daemonRunning: installed && state !== "daemon-down"
  readonly property bool operational: daemonRunning && registered
  readonly property bool transitioning: _transitionTarget !== ""
  readonly property var capabilities: Model.capabilities({
    state: state,
    connected: connected,
    registered: registered,
    registrationKnown: registrationKnown,
    settingsKnown: settingsKnown,
    managed: managed,
    locked: locked,
    consumerRegistrationAllowed: consumerRegistrationAllowed,
    termsRequired: termsRequired,
    busy: busy
  })
  readonly property bool canConnect: capabilities.canConnect
  readonly property bool canDisconnect: capabilities.canDisconnect
  readonly property bool canConfigure: capabilities.canConfigure
  readonly property bool canRegister: capabilities.canRegister
  readonly property bool canStartDaemon: capabilities.canStartDaemon
  readonly property int refreshIntervalSec: boundedInt(settings ? settings.refreshIntervalSec : 15, 15, 5, 300)

  property string _readStep: ""
  property string _readOut: ""
  property string _readErr: ""
  property bool _ignoreReadExit: false
  property bool _refreshQueued: false
  property bool _queuedDetails: false
  property bool _wantDetails: false
  property bool _detailsLoaded: false
  property bool _registrationPreflight: false
  property string _actionKind: ""
  property string _actionOut: ""
  property string _actionErr: ""
  property bool _ignoreActionExit: false
  property bool _continuingAction: false
  property string _transitionTarget: ""
  property int _transitionAttempts: 0

  function boundedInt(value, fallback, minimum, maximum) {
    var number = parseInt(String(value), 10)
    if (!isFinite(number)) number = fallback
    return Math.max(minimum, Math.min(maximum, number))
  }

  function statusJson() {
    return JSON.stringify(Model.publicStatus({
      state: state,
      connected: connected,
      mode: mode,
      protocol: protocol,
      families: families,
      managed: managed,
      locked: locked,
      busy: busy,
      error: lastError
    }))
  }

  // Each snapshot is serialized through one read process. The periodic timer
  // reads only status; details are refreshed on open, manual refresh, and after
  // completed mutations.
  function refresh(details) {
    var wantsDetails = details === true
    if (readProcess.running || actionProcess.running || _continuingAction) {
      _refreshQueued = true
      _queuedDetails = _queuedDetails || wantsDetails
      return
    }
    _refreshQueued = false
    _queuedDetails = false
    _wantDetails = wantsDetails
    _registrationPreflight = false
    refreshing = true
    startRead("status")
  }

  function startRead(step) {
    var command = Model.command(step, "", termsAccepted)
    if (!command.length) {
      statusError = "WARP status command failed"
      finishRefresh()
      return
    }
    _readStep = step
    _readOut = ""
    _readErr = ""
    readProcess.command = command
    readProcess.running = true
    readWatchdog.restart()
  }

  function clearDetails() {
    registered = false
    registrationKnown = false
    settingsKnown = false
    managed = false
    locked = false
    mode = "unknown"
    protocol = "unknown"
    families = "unknown"
    consumerRegistrationAllowed = false
    managedEnrollmentConfigured = false
    _detailsLoaded = false
  }

  function applyStatus(exitCode) {
    var previousState = state
    var result = Model.parseStatus(_readOut, _readErr, exitCode)
    state = result.state
    connected = result.connected === true
    statusError = result.error || ""
    termsRequired = result.termsRequired === true

    if (_transitionTarget !== "") {
      var transition = Model.transitionResult(_transitionTarget, state)
      if (transition.done && transition.success) finishTransition()
      else if (transition.done) failTransition(transition.error)
    }

    if (state === "missing-client" || state === "daemon-down") {
      clearDetails()
      finishRefresh()
      return
    }

    if (state === "unregistered") {
      if (previousState !== "unregistered") clearDetails()
      registered = false
      registrationKnown = true
      // Until the Terms are accepted, every other warp-cli read is rejected.
      // The confirmed registration action queries MDM configuration with the
      // fixed --accept-tos flag and fails closed unless its JSON is exactly the
      // recognized empty/unmanaged shape.
      if (termsRequired) {
        settingsKnown = false
        consumerRegistrationAllowed = false
        // Preserve a positively detected MDM enrollment across the ordinary
        // status refresh: --accept-tos is per invocation on current Linux, so
        // status returns this Terms prompt again after a blocked preflight.
        if (!managed) managedEnrollmentConfigured = false
        finishRefresh()
        return
      }
      if (_wantDetails || !_detailsLoaded) {
        _registrationPreflight = true
        settingsKnown = false
        consumerRegistrationAllowed = false
        managedEnrollmentConfigured = false
        startRead("settings")
      } else finishRefresh()
      return
    }

    // A successful status implies a registration. Configuration remains
    // disabled until registration and settings are positively identified.
    registered = true
    if (_wantDetails) startRead("registration")
    else finishRefresh()
  }

  function applyRegistration(exitCode) {
    var result = Model.parseRegistration(_readOut, _readErr, exitCode)
    termsRequired = result.termsRequired === true
    if (result.known) {
      registrationKnown = true
      registered = result.registered
      managed = result.managed
      if (!registered) {
        state = "unregistered"
        connected = false
        if (termsRequired) {
          consumerRegistrationAllowed = false
          finishRefresh()
          return
        }
        _registrationPreflight = true
      }
    } else {
      registrationKnown = false
      settingsKnown = false
    }
    startRead("settings")
  }

  function applySettings(exitCode) {
    var result = Model.parseSettings(_readOut, exitCode)

    if (_registrationPreflight) {
      var preflight = Model.registrationPreflight(result)
      settingsKnown = preflight.known
      managedEnrollmentConfigured = preflight.managed
      consumerRegistrationAllowed = preflight.allowed
      managed = preflight.managed
      _detailsLoaded = preflight.known
      finishRefresh()
      return
    }

    // Preserve the last known-good values on malformed or failed reads, while
    // disabling configuration until a complete new snapshot succeeds.
    var reduced = Model.reduceSettings({
      mode: mode, protocol: protocol, families: families, locked: locked, managed: managed
    }, result)
    settingsKnown = reduced.settingsKnown
    mode = reduced.mode
    protocol = reduced.protocol
    families = reduced.families
    locked = reduced.locked
    managed = reduced.managed
    _detailsLoaded = reduced.settingsKnown
    finishRefresh()
  }

  function readFinished(exitCode) {
    readWatchdog.stop()
    if (_ignoreReadExit) {
      _ignoreReadExit = false
      return
    }
    _readOut = String(readStdout.text || _readOut || "")
    _readErr = String(readStderr.text || _readErr || "")

    if (_readStep !== "status") {
      var terminal = Model.parseStatus(_readOut, _readErr, exitCode)
      if (terminal.state === "missing-client" || terminal.state === "daemon-down") {
        state = terminal.state
        connected = false
        statusError = terminal.error
        clearDetails()
        finishRefresh()
        return
      }
    }

    if (_readStep === "status") applyStatus(exitCode)
    else if (_readStep === "registration") applyRegistration(exitCode)
    else if (_readStep === "settings") applySettings(exitCode)
    else finishRefresh()
  }

  function finishRefresh() {
    readWatchdog.stop()
    refreshing = false
    _readStep = ""
    _wantDetails = false
    if (_refreshQueued && !actionProcess.running) {
      var details = _queuedDetails
      _refreshQueued = false
      _queuedDetails = false
      Qt.callLater(function() { root.refresh(details) })
    }
  }

  function actionLabel(kind) {
    if (kind === "connect") return "Connecting…"
    if (kind === "disconnect") return "Disconnecting…"
    if (kind === "start-daemon") return "Starting WARP service…"
    if (kind === "registration-preflight") return "Checking enrollment settings…"
    if (kind === "registration-check") return "Checking existing registration…"
    if (kind === "register") return "Registering device…"
    return "Applying setting…"
  }

  function showActionError(message) {
    actionError = Model.publicError(message)
    actionMessageTimer.restart()
  }

  function rejectAction(message) {
    showActionError(message)
    return false
  }

  function mutate(kind, value) {
    if (actionProcess.running || readProcess.running || actionBusy) return false
    if ((kind === "mode" || kind === "protocol" || kind === "families") && !canConfigure)
      return rejectAction(managed ? "Configuration is managed by your organization" : "Action is not allowed")
    if (kind === "mode" && value === "proxy" && protocol !== "MASQUE")
      return rejectAction("Local proxy requires MASQUE")
    if (kind === "protocol" && value === "WireGuard" && mode === "proxy")
      return rejectAction("WireGuard is unavailable in Local proxy mode")

    var command = Model.command(kind, value, termsAccepted)
    if (!command.length) return rejectAction("Unsupported WARP action")

    _actionKind = kind
    _actionOut = ""
    _actionErr = ""
    actionMessageTimer.stop()
    actionError = ""
    actionStatus = actionLabel(kind)
    actionBusy = true
    actionProcess.command = command
    actionProcess.running = true
    actionWatchdog.restart()
    return true
  }

  // Continue a multi-step mutation only after the current Process has fully
  // emitted its exit signal. Every step is still planned as an argument array
  // and receives the same explicit-consent decision as ordinary commands.
  function continueAction(kind, commandKind) {
    var command = Model.command(commandKind, "", termsAccepted)
    if (!command.length) {
      actionBusy = false
      actionStatus = ""
      showActionError("Unsupported WARP action")
      refresh(false)
      return
    }

    var expectedKind = kind
    _actionKind = kind
    _actionOut = ""
    _actionErr = ""
    actionStatus = actionLabel(kind)
    _continuingAction = true
    Qt.callLater(function() {
      root._continuingAction = false
      if (!root.actionBusy || root._actionKind !== expectedKind) return
      actionProcess.command = command
      actionProcess.running = true
      actionWatchdog.restart()
    })
  }

  function connect() { return canConnect ? mutate("connect", "") : false }
  function disconnect() {
    if (locked && connected) return rejectAction("Connection is locked by your organization")
    return canDisconnect ? mutate("disconnect", "") : false
  }
  function toggleWarp() { return connected ? disconnect() : connect() }
  function registerConsumer() {
    if (state !== "unregistered") return false
    if (!canRegister && !consumerRegistrationAllowed)
      return rejectAction("Consumer registration is unavailable")
    if (!canRegister) return false
    _sessionTermsAccepted = true
    // Always repeat the fail-closed MDM check after confirmation. A stale
    // consumer-capability snapshot must never bypass the enrollment guard.
    return mutate("registration-preflight", "")
  }
  function startDaemon() { return canStartDaemon ? mutate("start-daemon", "") : false }
  function setMode(value) { return canConfigure ? mutate("mode", value) : false }
  function setProtocol(value) { return canConfigure ? mutate("protocol", value) : false }
  function setFamilies(value) { return canConfigure ? mutate("families", value) : false }

  function actionFinished(exitCode) {
    actionWatchdog.stop()
    if (_ignoreActionExit) {
      _ignoreActionExit = false
      return
    }
    if (!actionBusy) return

    _actionOut = String(actionStdout.text || _actionOut || "")
    _actionErr = String(actionStderr.text || _actionErr || "")

    if (_actionKind === "registration-check") {
      var existing = Model.parseRegistration(_actionOut, _actionErr, exitCode)
      if (existing.known && existing.registered) {
        // Registration creation is not idempotent. Adopt the authoritative
        // accepted read instead of ever replacing an existing registration.
        _sessionTermsAccepted = true
        termsRequired = false
        registered = true
        registrationKnown = true
        managed = existing.managed
        consumerRegistrationAllowed = false
        actionBusy = false
        actionStatus = ""
        actionError = ""
        refresh(true)
        return
      }
      if (existing.known && !existing.registered
          && existing.termsRequired !== true) {
        continueAction("register", "register")
        return
      }

      // Unknown/newer output fails closed: only a positively recognized
      // missing registration may reach the creation command.
      actionBusy = false
      actionStatus = ""
      showActionError(Model.actionError(_actionKind, _actionOut, _actionErr, exitCode))
      refresh(false)
      return
    }

    if (Number(exitCode) !== 0) {
      if (_actionKind === "register"
          && Model.registrationAlreadyExists(_actionOut, _actionErr, exitCode)) {
        // A previous attempt may have completed in the daemon even if its
        // subsequent unaccepted status refresh could not observe it. Adopt the
        // existing registration through authoritative accepted reads; never
        // delete or recreate it.
        _sessionTermsAccepted = true
        actionBusy = false
        actionStatus = ""
        actionError = ""
        refresh(true)
        return
      }
      actionBusy = false
      actionStatus = ""
      showActionError(Model.actionError(_actionKind, _actionOut, _actionErr, exitCode))
      refresh(false)
      return
    }

    if (_actionKind === "registration-preflight") {
      var preflight = Model.parseMdmPreflight(_actionOut, _actionErr, exitCode)
      // MDM enrollment knowledge is deliberately distinct from a complete
      // WARP settings snapshot. Settings become mutable only after successful
      // registration and a later recognized settings read.
      settingsKnown = false
      managedEnrollmentConfigured = preflight.managed
      managed = preflight.managed
      consumerRegistrationAllowed = preflight.allowed
      termsRequired = false

      if (!preflight.allowed) {
        actionBusy = false
        actionStatus = ""
        showActionError(preflight.managed
          ? "Configuration is managed by your organization"
          : "Could not verify MDM configuration")
        refresh(true)
        return
      }

      // Registration creation is not idempotent. First perform an accepted,
      // read-only lookup and create only after a recognized missing result.
      continueAction("registration-check", "registration")
      return
    }

    if (_actionKind === "connect") beginTransition("connected")
    else if (_actionKind === "disconnect") beginTransition("disconnected")
    else {
      actionBusy = false
      actionStatus = ""
      refresh(true)
    }
  }

  function beginTransition(target) {
    _transitionTarget = target
    _transitionAttempts = 0
    transitionPoll.restart()
    refresh(false)
  }

  function finishTransition() {
    _transitionTarget = ""
    _transitionAttempts = 0
    actionBusy = false
    actionStatus = ""
    transitionPoll.stop()
    // Continue the current successful status snapshot into fresh details.
    _wantDetails = true
  }

  function failTransition(message) {
    _transitionTarget = ""
    _transitionAttempts = 0
    actionBusy = false
    actionStatus = ""
    transitionPoll.stop()
    showActionError(message)
  }

  Process {
    id: readProcess
    stdout: StdioCollector { id: readStdout; waitForEnd: true; onStreamFinished: root._readOut = text }
    stderr: StdioCollector { id: readStderr; waitForEnd: true; onStreamFinished: root._readErr = text }
    onExited: function(exitCode) { root.readFinished(exitCode) }
  }

  Process {
    id: actionProcess
    stdout: StdioCollector { id: actionStdout; waitForEnd: true; onStreamFinished: root._actionOut = text }
    stderr: StdioCollector { id: actionStderr; waitForEnd: true; onStreamFinished: root._actionErr = text }
    onExited: function(exitCode) { root.actionFinished(exitCode) }
  }

  Timer {
    id: pollTimer
    interval: root.refreshIntervalSec * 1000
    repeat: true
    running: !root.pollingPaused
    onTriggered: root.refresh(false)
  }

  Timer {
    id: transitionPoll
    interval: 1000
    repeat: true
    onTriggered: {
      root._transitionAttempts++
      if (root._transitionAttempts >= 15) {
        root._transitionTarget = ""
        root.actionBusy = false
        root.actionStatus = ""
        root.showActionError("Timed out waiting for WARP state")
        stop()
        root.refresh(false)
      } else if (!readProcess.running) root.refresh(false)
    }
  }

  Timer {
    id: actionMessageTimer
    interval: 8000
    onTriggered: root.actionError = ""
  }

  Timer {
    id: readWatchdog
    interval: 8000
    onTriggered: {
      root._ignoreReadExit = true
      if (readProcess.running) readProcess.running = false
      if (root._readStep === "status") {
        root.state = "error"
        root.connected = false
        root.statusError = "WARP status check timed out"
        if (root._transitionTarget !== "") root.failTransition(root.statusError)
      } else {
        root.settingsKnown = false
        root.consumerRegistrationAllowed = false
      }
      root.finishRefresh()
    }
  }

  Timer {
    id: actionWatchdog
    interval: root._actionKind === "start-daemon" ? 120000
      : (root._actionKind === "register" ? 60000 : 15000)
    onTriggered: {
      root._continuingAction = false
      root._ignoreActionExit = true
      if (actionProcess.running) actionProcess.running = false
      root.actionBusy = false
      root.actionStatus = ""
      root.showActionError("WARP action timed out")
      root.refresh(false)
    }
  }

  // Panel settings are injected by the host just after child construction.
  // Defer the first read one event-loop turn so persisted consent participates
  // in command planning from the initial snapshot, without reacting to later
  // consent changes and racing an explicitly confirmed registration action.
  Component.onCompleted: Qt.callLater(function() { root.refresh(true) })
}
