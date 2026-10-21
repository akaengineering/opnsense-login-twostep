<?php

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

namespace OPNsense\Auth\SSOProviders;

use OPNsense\Core\Config;

/**
 * Two-step login form for TOTP users (os-login-twostep).
 *
 * The stock login page (src/www/authgui.inc, display_login_form()) renders
 * Provider::renderLink() for every SSO provider the AuthenticationFactory
 * finds in this directory. renderLink() returns html_content verbatim when it
 * is set, which makes a provider the sanctioned way to add markup to the login
 * page without touching core files.
 *
 * This container yields exactly one such provider, and only when a TOTP
 * authentication server ("Local + Timebased One Time Password" or
 * "LDAP + Timebased One Time Password") is selected for the web GUI. Its
 * markup is a hidden <div> carrying the token length and token order as data
 * attributes plus the script and stylesheet that turn the login form into two
 * screens. Everything else (field names, POST body, authentication) stays
 * exactly as it is in core.
 *
 * The provider is never an authenticator: AuthenticationFactory::get() only
 * resolves real authentication servers, and type "sso" entries are skipped.
 *
 * Failure policy: any problem (missing classes, changed constructor, missing
 * files, unreadable config, exceptions) results in no provider being yielded,
 * so the worst case is the unchanged stock login form.
 */
class LoginTwoStep implements ISSOContainer
{
    /**
     * @var string[] authentication server types that use the OPNsense\Auth\TOTP trait
     */
    private const TOTP_TYPES = ['totp', 'ldap-totp'];

    /**
     * @var string document root behind the lighttpd "/ui/" alias
     */
    private const WWW_ROOT = '/usr/local/opnsense/www';

    /**
     * @var string script path relative to WWW_ROOT (served at /ui/...)
     */
    private const JS_FILE = '/js/login_twostep.js';

    /**
     * @var string stylesheet path relative to WWW_ROOT (served at /ui/...)
     */
    private const CSS_FILE = '/css/login_twostep.css';

    /**
     * {@inheritdoc}
     */
    public function listProviders(): \Generator
    {
        $provider = null;
        try {
            $provider = $this->buildProvider();
        } catch (\Throwable $e) {
            /* never let this plugin break the login page */
            $provider = null;
        }
        if ($provider !== null) {
            yield $provider;
        }
    }

    /**
     * @return Provider|null provider when the two-step form should be offered
     */
    private function buildProvider(): ?Provider
    {
        if (!$this->coreLooksCompatible()) {
            return null;
        }

        /*
         * The login form is only ever shown to anonymous visitors. A populated
         * session means we are being listed for an authenticated page instead,
         * e.g. the "Server" selector on System: Settings: Administration which
         * uses listServers('WebGui'). Stay out of that list.
         */
        if (!empty($_SESSION['Username'])) {
            return null;
        }

        $settings = $this->totpSettings();
        if ($settings === null) {
            return null;
        }

        return new Provider([
            'id' => 'login-twostep',
            'name' => 'os-login-twostep (two-step login form, not an authentication server)',
            'service' => 'WebGui',
            'html_content' => $this->renderHtml($settings),
        ]);
    }

    /**
     * Feature-detect the core pieces this plugin relies on.
     * @return bool
     */
    private function coreLooksCompatible(): bool
    {
        if (!class_exists(Provider::class) || !class_exists(Config::class)) {
            return false;
        }
        foreach (['id', 'name', 'service', 'html_content'] as $property) {
            if (!property_exists(Provider::class, $property)) {
                return false;
            }
        }
        if (!method_exists(Provider::class, 'renderLink')) {
            return false;
        }

        $constructor = (new \ReflectionClass(Provider::class))->getConstructor();
        if ($constructor === null || $constructor->getNumberOfParameters() !== 1) {
            return false;
        }
        $type = $constructor->getParameters()[0]->getType();
        if ($type !== null && (!($type instanceof \ReflectionNamedType) || $type->getName() !== 'array')) {
            return false;
        }

        return is_file(self::WWW_ROOT . self::JS_FILE) && is_file(self::WWW_ROOT . self::CSS_FILE);
    }

    /**
     * Find the first TOTP server in the web GUI authentication order and
     * return its token settings, mirroring OPNsense\Auth\TOTP::setTOTPProperties()
     * and OPNsense\Auth\Services\WebGui::supportedAuthenticators().
     * @return array|null ['otpLength' => int, 'passwordFirst' => bool]
     */
    private function totpSettings(): ?array
    {
        $configObj = Config::getInstance()->object();
        if (!isset($configObj->system)) {
            return null;
        }

        /* same parsing as Services\WebGui::supportedAuthenticators() */
        $authmode = (string)$configObj->system->webgui->authmode;
        $selected = !empty($authmode) ? explode(',', $authmode) : ['Local Database'];

        /* same discovery as AuthenticationFactory::listServers() */
        $totpServers = [];
        foreach ($configObj->system->children() as $key => $node) {
            if ($key != 'authserver' || empty($node->type) || empty($node->name)) {
                continue;
            }
            if (in_array((string)$node->type, self::TOTP_TYPES, true)) {
                $totpServers[(string)$node->name] = $node;
            }
        }
        if (empty($totpServers)) {
            return null;
        }

        foreach ($selected as $name) {
            if (!isset($totpServers[$name])) {
                continue;
            }
            $node = $totpServers[$name];
            /* TOTP trait: !empty(otpLength) overrides the default of 6 */
            $otpLength = (int)(string)$node->otpLength;
            if ($otpLength <= 0) {
                $otpLength = 6;
            }
            /* TOTP trait: passwordFirst is a checkbox stored as "1" when set */
            $passwordFirst = !empty((string)$node->passwordFirst);

            return ['otpLength' => $otpLength, 'passwordFirst' => $passwordFirst];
        }

        return null;
    }

    /**
     * Markup injected below the login form. Only integers leave this method
     * unescaped; everything else is attribute-escaped. No usernames, seeds or
     * codes are ever emitted.
     * @param array $settings token settings
     * @return string html
     */
    private function renderHtml(array $settings): string
    {
        $version = $this->assetVersion();
        $jsUri = '/ui' . self::JS_FILE . '?v=' . $version;
        $cssUri = '/ui' . self::CSS_FILE . '?v=' . $version;

        return sprintf(
            '<div id="login-twostep" data-otp-length="%d" data-password-first="%d" hidden></div>' . "\n" .
            '<link rel="stylesheet" href="%s">' . "\n" .
            '<script src="%s"></script>',
            (int)$settings['otpLength'],
            $settings['passwordFirst'] ? 1 : 0,
            htmlspecialchars($cssUri, ENT_QUOTES | ENT_HTML401),
            htmlspecialchars($jsUri, ENT_QUOTES | ENT_HTML401)
        );
    }

    /**
     * Cache buster for the static assets, changes whenever the package is (re)installed.
     * @return string
     */
    private function assetVersion(): string
    {
        $stamps = [
            @filemtime(self::WWW_ROOT . self::JS_FILE),
            @filemtime(self::WWW_ROOT . self::CSS_FILE),
        ];
        $version = max(array_map('intval', $stamps));
        return $version > 0 ? (string)$version : '1';
    }
}
