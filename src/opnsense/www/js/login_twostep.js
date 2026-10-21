/*
 * Copyright (C) 2026 AKA Engineering
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES,
 * INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 * AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY,
 * OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

/*
 * os-login-twostep: turn the stock OPNsense login form into two screens.
 *
 *   Screen 1  username + password, "Next"
 *   Screen 2  authentication code, "Back", "Login"
 *
 * On submit the code and the password are joined in the order the configured
 * TOTP server expects and written into the stock password field; the stock
 * submit button (name="login") then posts the form exactly as it always did.
 * Nothing is sent to the server that the stock form would not send: the code
 * field has no name attribute and never leaves the browser on its own.
 *
 * Progressive enhancement: the script bails out silently unless every stock
 * element it needs is present, and with JavaScript disabled the stock single
 * form keeps working.
 */
(function () {
    'use strict';

    var HIDDEN_CLASS = 'login-twostep-hidden';

    function hide(el) {
        if (el) {
            el.classList.add(HIDDEN_CLASS);
        }
    }

    function show(el) {
        if (el) {
            el.classList.remove(HIDDEN_CLASS);
        }
    }

    function closestGroup(el) {
        var node = el.parentNode;
        while (node && node.nodeType === 1) {
            if (node.classList.contains('form-group')) {
                return node;
            }
            node = node.parentNode;
        }
        return el;
    }

    function isEnter(ev) {
        return ev.key === 'Enter' || ev.keyCode === 13;
    }

    function init() {
        var wrapper = document.getElementById('login-twostep');
        var form = document.getElementById('iform');
        var userFld = document.getElementById('usernamefld');
        var passFld = document.getElementById('passwordfld');
        if (!wrapper || !form || !userFld || !passFld) {
            return;
        }
        var loginBtn = form.querySelector('button[name="login"]');
        if (!loginBtn || userFld.form !== form || passFld.form !== form) {
            return;
        }
        if (form.getAttribute('data-login-twostep') === 'ready') {
            return;
        }

        var otpLength = parseInt(wrapper.getAttribute('data-otp-length'), 10);
        if (!(otpLength > 0 && otpLength < 32)) {
            return;
        }
        var passwordFirst = wrapper.getAttribute('data-password-first') === '1';
        var codePattern = new RegExp('^[0-9]{' + otpLength + '}$');

        var userGroup = closestGroup(userFld);
        var passGroup = closestGroup(passFld);

        /* ---- screen 2 markup (built before touching the stock form) ---- */

        var step2 = document.createElement('div');
        step2.id = 'login-twostep-step2';

        var who = document.createElement('p');
        who.className = 'login-twostep-user text-muted';
        who.appendChild(document.createTextNode('Signing in as '));
        var whoName = document.createElement('strong');
        who.appendChild(whoName);
        step2.appendChild(who);

        var group = document.createElement('div');
        group.className = 'form-group';
        var label = document.createElement('label');
        label.htmlFor = 'otpfld';
        label.textContent = 'Authentication code:';
        group.appendChild(label);

        var otpFld = document.createElement('input');
        otpFld.id = 'otpfld';
        otpFld.type = 'text';
        otpFld.className = 'form-control';
        otpFld.setAttribute('inputmode', 'numeric');
        otpFld.setAttribute('autocomplete', 'one-time-code');
        otpFld.setAttribute('pattern', '[0-9]*');
        /*
         * Not exactly otpLength: browsers apply maxlength before any script
         * runs, so a code pasted as "123 456" would be cut to "123 45".
         * Whitespace is stripped on input and the exact length is enforced
         * on submit.
         */
        otpFld.setAttribute('maxlength', String(otpLength + 4));
        otpFld.setAttribute('autocapitalize', 'off');
        otpFld.setAttribute('autocorrect', 'off');
        otpFld.setAttribute('spellcheck', 'false');
        otpFld.setAttribute('tabindex', '1');
        /* deliberately no name attribute: the code is never posted on its own */
        group.appendChild(otpFld);

        var hint = document.createElement('p');
        hint.className = 'help-block login-twostep-hint';
        hint.textContent = 'Leave blank if your account has no authenticator.';
        group.appendChild(hint);
        step2.appendChild(group);

        var error = document.createElement('div');
        error.className = 'text-danger login-twostep-error';
        error.setAttribute('role', 'alert');

        var back = document.createElement('a');
        back.href = '#';
        back.id = 'login-twostep-back';
        back.className = 'login-twostep-back pull-left';
        back.textContent = 'Back';

        var nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.id = 'login-twostep-next';
        nextBtn.className = 'btn btn-primary pull-right';
        nextBtn.textContent = 'Next';

        /* ---- state ---- */

        var step = 1;
        var plainPassword = '';

        function setError(text) {
            error.textContent = text;
        }

        function clearError() {
            error.textContent = '';
        }

        function showStep1() {
            step = 1;
            if (plainPassword !== '') {
                /* undo any join from a cancelled submit */
                passFld.value = plainPassword;
            }
            show(userGroup);
            show(passGroup);
            show(nextBtn);
            hide(step2);
            hide(back);
            hide(loginBtn);
            clearError();
        }

        function showStep2() {
            if (userFld.value === '' || passFld.value === '') {
                setError('Please enter your username and password.');
                (userFld.value === '' ? userFld : passFld).focus();
                return;
            }
            step = 2;
            plainPassword = passFld.value;
            whoName.textContent = userFld.value;
            otpFld.value = '';
            hide(userGroup);
            hide(passGroup);
            hide(nextBtn);
            show(step2);
            show(back);
            show(loginBtn);
            clearError();
            otpFld.focus();
        }

        /*
         * Validate the code and write the combined secret into the stock
         * password field. Returns false when the form must not be submitted.
         */
        function applyCode() {
            var code = otpFld.value.replace(/\s+/g, '');
            otpFld.value = code;
            if (code !== '' && !codePattern.test(code)) {
                setError('The authentication code must be ' + otpLength + ' digits.');
                otpFld.focus();
                otpFld.select();
                return false;
            }
            if (code === '') {
                passFld.value = plainPassword;
            } else if (passwordFirst) {
                passFld.value = plainPassword + code;
            } else {
                passFld.value = code + plainPassword;
            }
            return true;
        }

        /* ---- wire up ---- */

        form.addEventListener('submit', function (ev) {
            if (step === 1) {
                /* implicit submission (Enter) on screen 1 moves on instead */
                ev.preventDefault();
                showStep2();
                return;
            }
            if (!applyCode()) {
                ev.preventDefault();
            }
            /* otherwise the stock button submits and login=1 is posted */
        });

        function onEnterStep1(ev) {
            if (step === 1 && isEnter(ev)) {
                ev.preventDefault();
                showStep2();
            }
        }
        userFld.addEventListener('keydown', onEnterStep1);
        passFld.addEventListener('keydown', onEnterStep1);

        nextBtn.addEventListener('click', function (ev) {
            ev.preventDefault();
            showStep2();
        });

        back.addEventListener('click', function (ev) {
            ev.preventDefault();
            showStep1();
            passFld.focus();
        });

        otpFld.addEventListener('input', function () {
            if (/\s/.test(otpFld.value)) {
                otpFld.value = otpFld.value.replace(/\s+/g, '');
            }
            clearError();
        });

        /* ---- mutate the stock form in one go ---- */

        form.noValidate = true;
        form.insertBefore(step2, loginBtn);
        form.insertBefore(error, loginBtn);
        form.insertBefore(back, loginBtn);
        loginBtn.parentNode.insertBefore(nextBtn, loginBtn.nextSibling);
        form.setAttribute('data-login-twostep', 'ready');
        showStep1();
    }

    function safeInit() {
        try {
            init();
        } catch (e) {
            /* leave whatever is on the page alone; the stock form still works */
            if (window.console && console.error) {
                console.error('login-twostep: disabled after error', e);
            }
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', safeInit);
    } else {
        safeInit();
    }
})();
