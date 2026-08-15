# Principal engineering and UX audit

Audit date: 2026-08-15

## Scope and evidence

The implementation was reviewed against the locally installed Omarchy 4 Quattro shell and its first-party Network, Tailscale, and Dropbox panels, the installed `warp-cli 2026.6.880.0` help/strings contract, current Cloudflare WARP documentation, the Omarchy plugin/publishing contract, and the marketplace automated security baseline.

The initial static audit did not install a package, change registration, or access a Cloudflare state file. Subsequent user-authorized live testing started the installed daemon and created a consumer registration through the plugin. The audit itself never edits Cloudflare state files, deletes a registration, or retries a registration while its result is uncertain.

## Native Omarchy comparison

| Concern | First-party pattern | WARP implementation |
| --- | --- | --- |
| Popup/focus | `KeyboardPanel` + `PanelKeyCatcher` | Same; one page, exclusive initial focus, Escape close, Tab handoff |
| Hierarchy | `PanelHero`, section headers, compact controls | Same hero, connection meta, policy pill, three native dropdowns |
| Navigation | Shared cursor plus `j`/`k` and arrows | Same cursor; Enter/Space activates; dropdown owns keys while open |
| Large themes | Scrollable content in Tailscale/Dropbox | Bounded `Flickable` with automatic cursor reveal |
| Theme adaptation | Bar/popup colors, `Style` spacing/type, bar font | No literal QML colors; all geometry/type/color comes from Omarchy tokens |
| Background work | Network keeps expensive work out of its fast polling path | 15-second status-only poll; details only on open/manual/action refresh |
| Mutations | Serialized process actions and bounded settle polling | One read process, one action process, command-local watchdogs, exact-state settling |
| Bar state | Mark reflects live state; warning remains visually urgent | Shape-distinct badge: check for connected, minus for disconnected, dot/pulse for activity, and undimmed urgent `!` for attention |

Tailscale can use an optimistic desired-state field because its service treats that field as UI intent. WARP’s contract explicitly forbids falsely claiming a connection, so this plugin intentionally differs: the switch, icon color, IPC, and `connected` property change only after `warp-cli status` reports the exact real state. Pending intent is represented only by the busy label and pulse.

## Release-blocking findings resolved

1. **Current CLI output was not parsed.** The old parser accepted only `Status:` while 2026.6 emits `Status update:`. It also missed source-prefixed settings such as `(network policy) Mode:`. Both are now anchored and tested.
2. **Settings enums were wrong.** Current internal values (`WarpWithDnsOverHttps`, `WarpProxy on port …`, and `WARP tunnel protocol`) now normalize through fixed aliases. Linux 2026.6 omits a Families label entirely, so Families state is derived only from the anchored `Resolve via:` value: the documented `cloudflare-dns.com`/`one.one.one.one`, `security.cloudflare-dns.com`, and `family.cloudflare-dns.com` hosts map to Off, Malware, and Malware + adult content respectively. Custom, malformed, and unfamiliar resolvers remain Unknown and fail configuration closed.
3. **Disconnect could finish during Disconnecting.** Transition reduction now requires `state === target`. Terminal network/daemon/registration/errors stop immediately; all other intermediate states continue one-second polling.
4. **Connection was shown optimistically.** The desired-state visual path was removed. Confirmed `connected` is the only authority.
5. **Refreshes raced and invalidated each other.** Reads are now serialized, one pending refresh is coalesced, and every command gets its own non-extendable watchdog.
6. **Detail failures failed open.** Registration/settings capabilities require positively recognized snapshots. A failed or partial read preserves last-known display values but disables mutation.
7. **Managed and Switch Locked semantics were conflated.** Managed registration makes configuration read-only. `Switch Locked` independently blocks disconnect while still allowing permitted configuration and connect actions.
8. **Consumer registration could trigger managed enrollment.** Current `registration new` may inherit an MDM Organization. Before Terms acceptance, 2026.6 blocks even ordinary reads. The confirmed flow therefore queries `--json --accept-tos mdm get-configs` first and chains registration only for the exact empty `{active, available}` configuration shape; managed, failed, or unfamiliar output fails closed.
9. **Local proxy allowed an invalid protocol.** Both UI options and service guards enforce MASQUE. The panel also explains that only proxy-configured applications are routed.
10. **Families/protocol applicability was misleading.** DNS-only modes explain that tunnel protocol is stored but inactive. Local proxy and Traffic-only explain that Families is not active.
11. **Errors could leak identifiers through IPC.** Status/action errors are categorical and `publicStatus` independently allowlists every enum and message. Tests inject tokens, hostnames, URLs, and organization names.
12. **WARP authorization was mistaken for Polkit cancellation.** Only a failed `start-daemon` authentication maps to cancellation; WARP `NotAuthorized` maps to a policy-neutral rejection.
13. **Dropdown mouse/keyboard state could diverge.** Each native dropdown restores its binding to confirmed service state after selection, including failed actions. Hover updates the exact matching cursor row.
14. **The original tab layout broke keyboard access.** Configuration now lives in the single main panel; Tab exclusively performs the native adjacent-panel switch.
15. **The icon/badge animation affected the whole hit target.** Only the inner generic cloud mark pulses. Click geometry and the urgent badge remain stable.
16. **Terms acceptance was incorrectly treated as persistent CLI state.** On Linux 2026.6, non-interactive commands continue to require `--accept-tos` after a successful registration. Explicit confirmation now persists only a native bar-entry `termsAccepted` boolean, and every later WARP command receives the fixed global flag. No credential or Cloudflare identifier is stored.
17. **An existing registration could be presented as a failed registration.** The exact existing-registration response now triggers an accepted authoritative refresh and adoption. The plugin never deletes the existing registration and never treats arbitrary failures as success.

## Architecture after simplification

- `Model.js` is pure parsing, normalization, capability/transition reduction, command planning, and public redaction. It has no QML or process state and is exhaustively unit tested.
- `Service.qml` owns two bounded processes. Reads serialize status → registration → settings when details are requested; the timer and transition loop execute status only. Mutations serialize and refresh on completion. Once explicitly confirmed, a native persisted boolean causes every WARP invocation to include the required global Terms flag.
- `Panel.qml` is declarative UI only. It asks the service for capabilities and never constructs a command or interprets raw output.
- `PanelConfirmDialog.qml` keeps confirmation typography at the panel's body/caption scale while reusing Omarchy's theme, border, and cursor tokens.
- `CloudIcon.qml` is a generic code-native shape. There is no proprietary Cloudflare asset or icon-font dependency.

This separation keeps the security-sensitive command and parsing surface testable without inventing a general process framework. The runtime exposes no shell, arbitrary executable, arbitrary setting, or user-controlled argument surface.

## Security review

- Every command is an argument array selected from fixed command/value allowlists.
- Locale, ANSI, color, terminal, and pagination behavior are fixed for reads.
- No `sh -c`, interpolation, detached process, downloaded code, state-file editing, registration deletion, settings reset, or secret-bearing feature exists.
- The only persisted consent data is the native boolean `termsAccepted`; it contains no Cloudflare credential, identifier, configuration, or raw CLI output.
- The only privileged array is `pkexec systemctl enable --now warp-svc.service`, behind a visible confirmation.
- Public IPC contains nine normalized fields and no organization/registration/raw diagnostic data.
- Marketplace baseline outcome is expected to be **review-required** for the documented `privilege` and `service-management` capabilities. No documented blocking finding is present. The actual marketplace result must be generated against the final public repository’s exact commit SHA.

## Verification completed

- Node tests cover status/error/registration/settings/MDM fixtures, consent-aware command mappings, existing-registration adoption, injection rejection, state transitions, capabilities, fail-closed reduction, and public secret redaction.
- Repository contract validation and `omarchy plugin validate .` pass.
- Advisory `qmllint` was invoked; this host’s Qt parser returns 255 on Quickshell’s typed `IpcHandler` method syntax, which the authoritative running Omarchy shell loads successfully.
- The live local plugin was disabled/enabled, retained its right-side placement after `omarchy.network`, loaded without plugin-specific QML errors, opened through IPC, and correctly reported the installed client as `daemon-down` rather than missing.
- A subsequent in-panel startup was authenticated successfully: `warp-svc.service` became active and enabled. Live registration testing exposed the exact 2026.6 pre-registration Terms gate, confirmed that acceptance is invocation-scoped, and created a valid consumer registration. The daemon reported a successful registration and accepted read-only checks reported the real Disconnected state. The strict JSON MDM preflight and consent-aware command path now reflect that live contract.
- The live default consumer settings snapshot omitted a Families label and reported `Resolve via: cloudflare-dns.com`; this is normalized to Off. Unit fixtures cover the other official Families endpoints and verify that custom or unknown resolvers remain Unknown without retaining or exposing their values.
- The root preview is fabricated connected-state data and contains no identifiers or proprietary logo.

## Honest release gaps

Before `v1.0.0`, complete the remaining live smoke checks in `RELEASE_CHECKLIST.md`: test cancellation of daemon authentication, confirm the Terms/preflight flow on an MDM-configured fixture, verify persisted consent across a clean shell restart, exercise the Malware and Malware + adult content actions against live 2026.6 output, exercise all remaining configuration actions and exact connect/disconnect transitions, test a real failure, and verify removal leaves WARP untouched.

These are integration checks, not known code failures. The remaining Families gap is live post-mutation confirmation; the parser mapping itself is anchored, allowlisted, and backed by Cloudflare’s published resolver table.
