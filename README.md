# os-login-twostep

Two-step web GUI login for OPNsense installs that use the
**Local + Timebased One Time Password** (or **LDAP + Timebased One Time
Password**) authentication server.

Stock OPNsense expects the TOTP code and the password typed into *one*
password field (`token+password`, or `password+token` when "Reverse token
order" is ticked). This plugin turns the login page into two screens:

1. **Username** and **password**, button reads **Next**.
2. **Authentication code**, a **Back** link, "Signing in as *user*", button
   reads **Login**.

On submit, JavaScript joins the code and the password in the order the
configured TOTP server expects, writes the result into the stock password
field and submits the stock form. Nothing changes server-side: no core file is
modified or patched, the POST body is identical to the stock form, and the
authentication flow is untouched.

Written and verified against **OPNsense 26.7** (core `stable/26.7`, plugins
`stable/26.7`).

## Screenshots

<img width="462" height="384" alt="image" src="https://github.com/user-attachments/assets/833d6c10-2032-4f4f-8a03-df029e0741d7" />

<img width="457" height="367" alt="image" src="https://github.com/user-attachments/assets/996b9b66-df86-4062-8d94-c6c32a780584" />

## Security note

This is a usability change only. The browser still sends exactly one
`passwordfld` value containing code and password concatenated, so the strength
of the login is identical to the stock combined field. The code is never posted
on its own (the code input has no `name` attribute) and no usernames, seeds or
codes are ever written into the page by the server. The only information the
page reveals is that a TOTP server is configured for the GUI, together with its
token length and order, and only when such a server is actually selected;
without one the login page is byte-for-byte stock.

## Requirements

- OPNsense 26.7 (other versions: see [Upgrade survival](#upgrade-survival)).
- A **Local + Timebased One Time Password** or **LDAP + Timebased One Time
  Password** server configured under *System > Access > Servers* and selected
  under *System > Settings > Administration > Authentication > Server*. The
  plugin reads **Token length** (6 or 8) and **Reverse token order** from it.
- If several TOTP servers are selected, the first one in the configured order
  (which is also the order OPNsense tries them in) determines length and order.
- Without a selected TOTP server the plugin yields nothing and the login page
  is unchanged.

## Install

Run as root on the firewall over SSH, or from console option 8. The plugin is
built with the stock `Mk/plugins.mk` from the OPNsense plugins repository, so
that repository has to be checked out at the branch matching your version
(`opnsense-version -v`).

```sh
pkg install -y git
git clone https://github.com/opnsense/plugins /usr/plugins
git -C /usr/plugins checkout stable/26.7
git clone https://github.com/akaengineering/opnsense-login-twostep /usr/plugins/security/login-twostep
make -C /usr/plugins/security/login-twostep upgrade
```

`make upgrade` builds the package (`os-login-twostep-1.0.pkg` under
`work/pkg/`) and installs it with `pkg add`. Reload the login page afterwards;
no service restart is needed. Under *System > Firmware > Plugins* the package
shows as **orphaned** (not from the repository). That is cosmetic.

The repository root *is* the plugin directory, so it must live two levels below
the plugins checkout (`/usr/plugins/<category>/<name>`) for the relative
`.include "../../Mk/plugins.mk"` to resolve.

## Update

```sh
git -C /usr/plugins/security/login-twostep pull
make -C /usr/plugins/security/login-twostep upgrade
```

## Uninstall

```sh
pkg delete -y os-login-twostep
```

The stock login form is back immediately. `make clean` in the plugin directory
removes the `work/` build output (note that it also runs `git checkout -f src`,
discarding local edits under `src/`).

## How it hooks in

All of this was verified against core `stable/26.7`:

- `display_login_form()` in `src/www/authgui.inc` renders the stock form and
  then, for every provider returned by
  `AuthenticationFactory::listSSOproviders('WebGui')`, echoes
  `<div class="login-sso-link-container">` + `$provider->renderLink()`.
- `listSSOproviders()` globs
  `src/opnsense/mvc/app/library/OPNsense/Auth/SSOProviders/*.php`, instantiates
  every class implementing `ISSOContainer` (no constructor arguments) and
  consumes its `listProviders(): \Generator`.
- `Provider` is built from an array (`id, appcode, name, login_uri, service,
  html_content`) and `renderLink()` returns `html_content` verbatim when set.
  That is the injection point this plugin uses.
- The plugin ships one class, `OPNsense\Auth\SSOProviders\LoginTwoStep`. It
  reads `system/webgui/authmode` (same parsing as
  `Auth\Services\WebGui::supportedAuthenticators()`), finds the first selected
  `<authserver>` of type `totp` or `ldap-totp` (both use the `OPNsense\Auth\TOTP`
  trait, whose `otpLength` / `passwordFirst` handling is mirrored) and yields a
  `Provider` whose `html_content` is
  `<div id="login-twostep" data-otp-length="6|8" data-password-first="0|1" hidden>`
  plus `<link>`/`<script>` tags for `/ui/css/login_twostep.css` and
  `/ui/js/login_twostep.js`. Files under `/usr/local/opnsense/www/` are served
  at `/ui/` by the lighttpd alias in `webgui.inc`.
- `session_auth()` only treats a POST as a login when `$_POST['login']` is set.
  The script therefore never calls `form.submit()`; the stock
  `<button name="login" value="1">` does the submitting (explicitly or through
  implicit Enter-key submission), so `login=1` is always posted.
- Everything in `listProviders()` is wrapped in `try/catch` and preceded by
  feature detection (`Provider` class, property names, constructor signature,
  asset files present). Any failure yields nothing, i.e. the stock login page.

### Where else the provider shows up

`AuthenticationFactory::listServers($service)` folds SSO providers into the
server list when a service is given. In core `stable/26.7` the only caller
passing `'WebGui'` is `system_advanced_admin.php` (the *Server* selector under
*System > Settings > Administration*). Two measures keep the plugin out of the
way there:

- The provider is only yielded when no GUI user is logged in
  (`empty($_SESSION['Username'])`). The login form is only ever rendered for
  anonymous visitors, while the administration page always runs inside an
  authenticated session, so the entry never appears in that selector.
- Should it still be listed somewhere (its name is
  "os-login-twostep (two-step login form, not an authentication server)"),
  selecting it is harmless: `AuthenticationFactory::get()` only resolves real
  servers, so an `sso` entry in `authmode` is skipped during authentication.

`AuthenticationServerField` (MVC models) also calls `listServers()` with a
service, but only Captive Portal sets one, so no MVC form lists the provider.
`diag_authentication.php` and the OpenVPN/IPsec pages call it without a service
and never see SSO providers.

One edge case: `session_auth()` shows the login form to a logged-in user whose
session protocol no longer matches (HTTP/HTTPS switched). That request still
has `$_SESSION['Username']` set, so it gets the stock form once.

### Deviations from the original brief

- `ldap-totp` is handled in addition to `totp`; both use the same TOTP trait.
- The code input's `maxlength` is token length + 4 rather than exactly the token
  length. Browsers apply `maxlength` before any script runs, so an exact limit
  would truncate a code pasted as `123 456` to `123 45` and defeat the
  whitespace stripping. Whitespace is stripped live on input and the exact
  length is enforced on submit.
- The provider is suppressed for authenticated sessions (see above) so that it
  does not clutter the administration page.

## Behaviour details

- Progressive enhancement: the script bails out silently unless `#iform`,
  `#usernamefld`, `#passwordfld`, `button[name=login]` and `#login-twostep` all
  exist and the data attributes are sane. With JavaScript disabled the stock
  single form works as before.
- Screen 1: the stock button is hidden (via a CSS class, Bootstrap's `.btn`
  beats the `hidden` attribute) and a **Next** button is added. Enter in the
  username or password field triggers Next. Next requires both fields to be
  non-empty.
- Screen 2: the username/password groups are hidden but stay in the form,
  enabled, so they are posted. "Signing in as *user*" is set with
  `textContent`. The code input is `id="otpfld"`, `type="text"`,
  `inputmode="numeric"`, `autocomplete="one-time-code"`, `pattern="[0-9]*"`,
  no `name`. The hint reads "Leave blank if your account has no authenticator"
  (useful when a second, non-TOTP server such as Local Database is selected
  alongside; a TOTP-only setup rejects users without a seed regardless).
  **Back** returns to screen 1 without clearing anything.
- Submit: whitespace is stripped from the code; a non-empty code that is not
  exactly N digits shows an inline error and stops. Otherwise
  `passwordfld = passwordFirst ? password + code : code + password` (empty code
  leaves the password unchanged) and the stock button submits. The `?url=`
  redirect is preserved because it is the same form posting to the same URL.
- After a failed login the server re-renders screen 1 with
  "Wrong username or password." exactly as stock.
- Styling uses the theme's Bootstrap 3 classes (`form-group`, `form-control`,
  `btn btn-primary`, `help-block`, `text-danger`), so every theme applies.

## Test checklist

After installing, check on the real firewall:

- [ ] Correct code logs in (token-first default).
- [ ] Wrong code: "Wrong username or password.", screen 1 again.
- [ ] Empty code: with Local Database also selected a user without a seed logs
      in; with TOTP only the login is rejected (stock behaviour).
- [ ] Back link returns to screen 1 with username and password intact.
- [ ] Enter key on screen 1 goes to screen 2 without posting; Enter on screen 2
      submits.
- [ ] `?url=` redirect: open `/system_general.php` while logged out, log in,
      land on that page.
- [ ] Password containing special characters (`+ & % = space` and non-ASCII).
- [ ] "Reverse token order" on and off.
- [ ] 8-digit tokens (field accepts 8, rejects 7).
- [ ] A second (non-TOTP) auth server selected alongside the TOTP server.
- [ ] JavaScript disabled: stock single form, combined code+password works.
- [ ] Pasting a code with grouping spaces ("123 456") works.
- [ ] *System > Log Files > Web GUI* shows no PHP errors.
- [ ] *System > Settings > Administration > Authentication > Server* does not
      list the plugin.
- [ ] `pkg delete -y os-login-twostep` restores the stock form.

Before release the repository's CI runs `php -l` on every PHP file and
`node --check` on the script. The client-side logic was additionally exercised
with a headless Chromium against a replica of the 26.7 login page (screen
transitions, Enter handling, both token orders, 6 and 8 digits, whitespace,
`login=1` and `?url=` in the POST, fallbacks).

## Upgrade survival

OPNsense updates leave locally added packages alone, so the plugin survives
`opnsense-update`. The real risk is the hook itself: the login page is legacy
code slated for a rewrite (core issue
[opnsense/core#8239](https://github.com/opnsense/core/issues/8239), "Input
Field for 2FA Code During Login", which asks for exactly this feature and is
assigned for a future release). If the SSO provider loop or the form's element
ids change, the plugin degrades to the stock form: either the provider is not
rendered or the script finds nothing to enhance. Rebuild against the new
version (`git pull` + `make upgrade`) or remove the package as appropriate.
When core ships its own two-step login, uninstall this plugin.

## Layout

```
Makefile                      # PLUGIN_NAME= login-twostep, builds with Mk/plugins.mk
pkg-descr
LICENSE                       # BSD-2-Clause
README.md
CHANGELOG.md
.github/workflows/lint.yml    # php -l on every .php, node --check on the .js
src/opnsense/mvc/app/library/OPNsense/Auth/SSOProviders/LoginTwoStep.php
src/opnsense/www/js/login_twostep.js
src/opnsense/www/css/login_twostep.css
```

No core files are overwritten, no `opnsense-patch`, no post-install scripts.

## Authorship

This plugin was coded by Claude, Anthropic's AI assistant, working through
Claude Code on behalf of AKA Engineering, who specified the behaviour,
reviewed the result and maintain the repository. The core hooks were
verified by Claude against OPNsense `stable/26.7` sources; the on-firewall
checklist above is for humans. Treat it like any other third-party code and
review it before putting it in front of a production login page.

## License

BSD-2-Clause, see [LICENSE](LICENSE).
