"""Regression tests for app/mailer.py's language selection on the two
newer transactional email flows (contract confirmation, withdrawal
receipt/outcome). Narrow unit tests of the mailer module itself (not an
end-to-end webhook/checkout flow, which tests/test_contract_confirmation.py
and tests/test_withdrawal_requests.py already cover): these assert that
the SAME language the purchaser/requester actually selected and had
durably persisted (declarations['language'] / statement_language) is the
language the email is actually sent in, never a hardcoded German default
and never a UI/browser-guessed language independent of what was recorded.
"""

import os

os.environ.setdefault('SECRET_KEY', 'test-secret-key-for-testing-only')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')
os.environ.setdefault('AWS_SECURITY_TOKEN', 'testing')
os.environ.setdefault('AWS_SESSION_TOKEN', 'testing')
os.environ.setdefault('AWS_DEFAULT_REGION', 'eu-central-1')

from sites.ffm.app import mailer


def _capture(monkeypatch):
    sent = {}

    def fake_send(to_email, subject, body_text):
        sent['to_email'] = to_email
        sent['subject'] = subject
        sent['body_text'] = body_text

    monkeypatch.setattr(mailer, '_send', fake_send)
    return sent


# ============ Contract confirmation email ============

def _confirmation(language, **overrides):
    confirmation = {
        'contract_reference': 'ref-123',
        'confirmed_at': '2026-01-01T00:00:00+00:00',
        'price_and_renewal_summary_de': 'DE Preis- und Verlaengerungstext.',
        'price_and_renewal_summary_en': 'EN price and renewal text.',
        'withdrawal_instructions_de': 'DE Widerrufsbelehrung.',
        'withdrawal_instructions_en': 'EN withdrawal instructions.',
        'declarations': {
            'version': 'checkout-declarations-v1-2026-10-16',
            'language': language,
            'accepted_at': '2026-01-01T00:00:00+00:00',
            'immediate_access_text': 'Immediate access declaration text.',
            'withdrawal_waiver_text': 'Withdrawal waiver declaration text.',
        },
    }
    confirmation.update(overrides)
    return confirmation


def test_contract_confirmation_email_uses_the_persisted_declarations_language_de(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_contract_confirmation_email('user@example.com', _confirmation('de'))
    assert sent['to_email'] == 'user@example.com'
    assert 'Hallo,' in sent['body_text']
    assert 'DE Preis- und Verlaengerungstext.' in sent['body_text']
    assert 'DE Widerrufsbelehrung.' in sent['body_text']
    assert 'EN price and renewal text.' not in sent['body_text']
    assert 'EN withdrawal instructions.' not in sent['body_text']
    assert 'Bestaetigung' in sent['subject']


def test_contract_confirmation_email_uses_the_persisted_declarations_language_en(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_contract_confirmation_email('user@example.com', _confirmation('en'))
    assert 'Hello,' in sent['body_text']
    assert 'EN price and renewal text.' in sent['body_text']
    assert 'EN withdrawal instructions.' in sent['body_text']
    assert 'DE Preis- und Verlaengerungstext.' not in sent['body_text']
    assert 'DE Widerrufsbelehrung.' not in sent['body_text']
    assert 'Confirmation' in sent['subject']


def test_contract_confirmation_email_never_hardcodes_german_regardless_of_dict_key_order(monkeypatch):
    """Guards against a future regression that silently reverts to always
    reading the '..._de' snapshot fields regardless of the purchaser's
    actual selection."""
    sent = _capture(monkeypatch)
    mailer.send_contract_confirmation_email('user@example.com', _confirmation('en'))
    # The exact declaration text the purchaser accepted is still echoed
    # back verbatim regardless of language (it's stored, not translated).
    assert 'Immediate access declaration text.' in sent['body_text']
    assert 'Withdrawal waiver declaration text.' in sent['body_text']


def test_contract_confirmation_email_falls_back_to_german_only_when_language_is_missing(monkeypatch):
    """Only reached if declarations are missing entirely (should not
    happen for a real checkout-created subscription -- see billing.py's
    error log at that call site) -- must not raise a KeyError."""
    sent = _capture(monkeypatch)
    confirmation = _confirmation('de')
    confirmation['declarations'] = {}
    mailer.send_contract_confirmation_email('user@example.com', confirmation)
    assert 'DE Preis- und Verlaengerungstext.' in sent['body_text']


# ============ Withdrawal receipt email ============

def test_withdrawal_receipt_email_uses_the_requesters_persisted_statement_language_de(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_withdrawal_request_receipt_email(
        'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00',
        'DE Erklaerungstext', 'DE Belegtext', language='de',
    )
    assert 'Hallo,' in sent['body_text']
    assert 'Eingangsbestaetigung' in sent['subject']
    assert 'DE Erklaerungstext' in sent['body_text']
    assert 'DE Belegtext' in sent['body_text']


def test_withdrawal_receipt_email_uses_the_requesters_persisted_statement_language_en(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_withdrawal_request_receipt_email(
        'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00',
        'EN statement text', 'EN receipt text', language='en',
    )
    assert 'Hello,' in sent['body_text']
    assert 'Receipt confirmation' in sent['subject']
    assert 'EN statement text' in sent['body_text']
    assert 'EN receipt text' in sent['body_text']
    assert 'Hallo,' not in sent['body_text']


def test_withdrawal_receipt_email_defaults_to_german_when_language_is_unrecognized(monkeypatch):
    """An unknown/unsupported language value must never raise or silently
    produce an empty email -- it safely falls back to German rather than
    guessing at an unsupported translation."""
    sent = _capture(monkeypatch)
    mailer.send_withdrawal_request_receipt_email(
        'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00',
        'text', 'receipt', language='fr',
    )
    assert 'Hallo,' in sent['body_text']


# ============ Withdrawal outcome email ============

def test_withdrawal_outcome_email_uses_the_requesters_persisted_statement_language_de(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_withdrawal_request_outcome_email(
        'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00', 'fulfilled',
        {'subscription_canceled_immediately': True, 'refund_provider_reference': 're_123', 'note': 'ok'},
        language='de',
    )
    assert 'Hallo,' in sent['body_text']
    assert 'bearbeitet' in sent['subject']
    assert 'Das zugehoerige Abonnement wurde sofort beendet.' in sent['body_text']
    assert 'Rueckerstattungsreferenz: re_123' in sent['body_text']
    assert 'Anmerkung des Mitarbeiters: ok' in sent['body_text']


def test_withdrawal_outcome_email_uses_the_requesters_persisted_statement_language_en(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_withdrawal_request_outcome_email(
        'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00', 'no_match',
        None, language='en',
    )
    assert 'Hello,' in sent['body_text']
    assert 'processed' in sent['subject']
    assert 'could not be matched to an active' in sent['body_text']
    assert 'Hallo,' not in sent['body_text']


def test_withdrawal_outcome_email_still_rejects_unknown_outcomes_regardless_of_language(monkeypatch):
    _capture(monkeypatch)
    import pytest as _pytest
    with _pytest.raises(ValueError):
        mailer.send_withdrawal_request_outcome_email(
            'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00', 'bogus', language='en',
        )


# ============ Pre-existing auth-action emails: locale propagation ============
#
# These four functions pre-date this feature and were English-only
# (verification/reset/email-change) or German-only (cancel-request ack)
# regardless of the UI's actual language, per a read-only audit. The
# tests below cover the newly added `language` parameter: a validated
# selection must change both the body/subject AND the link's `?lang=`
# (so re-opening the link reopens the SPA in the same language), while an
# unrecognized/missing value must safely fall back to each function's
# pre-existing default rather than raising or producing an empty email.

def test_verification_email_defaults_to_english_when_no_language_given(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123')
    assert 'Hi alice,' in sent['body_text']
    assert 'verify your account' in sent['subject']
    assert 'verify_token=tok123&lang=en' in sent['body_text']


def test_verification_email_in_german_when_language_de(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123', language='de')
    assert 'Hallo alice,' in sent['body_text']
    assert 'bestätige dein Konto' in sent['subject']
    assert 'verify_token=tok123&lang=de' in sent['body_text']
    assert 'Hi alice,' not in sent['body_text']


def test_verification_email_falls_back_to_english_for_unrecognized_language(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123', language='fr')
    assert 'Hi alice,' in sent['body_text']
    assert 'lang=en' in sent['body_text']


def test_password_reset_email_defaults_to_english_when_no_language_given(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_password_reset_email('user@example.com', 'bob', 'rtok')
    assert 'Hi bob,' in sent['body_text']
    assert 'Reset your Arithmo Slayer password' in sent['subject']
    assert 'reset_token=rtok&lang=en' in sent['body_text']


def test_password_reset_email_in_german_when_language_de(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_password_reset_email('user@example.com', 'bob', 'rtok', language='de')
    assert 'Hallo bob,' in sent['body_text']
    assert 'Passwort zurück' in sent['subject']
    assert 'reset_token=rtok&lang=de' in sent['body_text']
    assert 'Hi bob,' not in sent['body_text']


def test_email_change_confirmation_defaults_to_english_when_no_language_given(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_email_change_confirmation('new@example.com', 'carol', 'ctok')
    assert 'Hi carol,' in sent['body_text']
    assert 'Confirm your new email address' in sent['subject']
    assert 'confirm_email_token=ctok&lang=en' in sent['body_text']


def test_email_change_confirmation_in_german_when_language_de(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_email_change_confirmation('new@example.com', 'carol', 'ctok', language='de')
    assert 'Hallo carol,' in sent['body_text']
    assert 'Bestätige deine neue E-Mail-Adresse' in sent['subject']
    assert 'confirm_email_token=ctok&lang=de' in sent['body_text']
    assert 'Hi carol,' not in sent['body_text']


def test_email_change_confirmation_falls_back_to_english_for_unrecognized_language(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_email_change_confirmation('new@example.com', 'carol', 'ctok', language='xx')
    assert 'Hi carol,' in sent['body_text']
    assert 'lang=en' in sent['body_text']


def test_cancel_request_ack_email_defaults_to_german_when_no_language_given(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_cancel_request_ack_email(
        'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00', 'fulfilled',
    )
    assert 'Hallo,' in sent['body_text']
    assert 'bearbeitet' in sent['subject']
    assert 'Kuendigungsanfrage' in sent['subject']


def test_cancel_request_ack_email_in_english_when_language_en(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_cancel_request_ack_email(
        'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00', 'no_subscription',
        language='en',
    )
    assert 'Hello,' in sent['body_text']
    assert 'has been processed' in sent['subject']
    assert 'no active subscription was found' in sent['body_text']
    assert 'Hallo,' not in sent['body_text']


def test_cancel_request_ack_email_falls_back_to_german_for_unrecognized_language(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_cancel_request_ack_email(
        'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00', 'fulfilled',
        language='fr',
    )
    assert 'Hallo,' in sent['body_text']


def test_cancel_request_ack_email_still_rejects_unknown_outcomes_regardless_of_language():
    import pytest as _pytest
    with _pytest.raises(ValueError):
        mailer.send_cancel_request_ack_email(
            'req@example.com', 'req-1', '2026-01-01T00:00:00+00:00', 'bogus', language='en',
        )


# ============ Registration/welcome email manual: key product facts ============
#
# A read-only audit of the embedded welcome-email "quick manual" found it
# was missing several player-facing facts (free levels 1-2 vs. paid
# 3-60, subscription price/cadence/auto-renew, where to redeem a gift
# code, the adult-account/child-use policy, and that a password change
# revokes other sessions) and that it miscalculated the leaderboard
# window (the backend deliberately does NOT filter by recency — see
# models.get_leaderboard()'s docstring — so no email/UI copy may claim a
# "last 2 weeks" leaderboard window). These tests assert the corrected
# copy is present in both languages and is sourced from -- not merely
# hoped to match -- the actual pricing constants in app/legal_texts.py
# and the actual free/paid level boundary in app/entitlements.py, so a
# future price or cutoff change can't silently desync the email text
# from reality without failing a test.

from sites.ffm.app import legal_texts


def test_verification_email_manual_states_correct_free_vs_paid_level_boundary(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123')
    assert 'Levels 1-2 are free forever' in sent['body_text']
    assert 'levels 3-60 need a Premium subscription' in sent['body_text']


def test_verification_email_manual_price_matches_legal_texts_constants_en(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123')
    assert legal_texts.PRICE_EUR_EN in sent['body_text']
    assert f'every {legal_texts.BILLING_INTERVAL_MONTHS} calendar months' in sent['body_text']
    assert 'auto-renews' in sent['body_text']
    assert 'all applicable taxes included' in sent['body_text']
    # Never claim a VAT-specific breakdown -- only the generic, legally
    # accurate "all applicable taxes" phrasing legal_texts.py also uses.
    assert 'VAT' not in sent['body_text']


def test_verification_email_manual_price_matches_legal_texts_constants_de(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123', language='de')
    assert legal_texts.PRICE_EUR in sent['body_text']
    assert f'alle {legal_texts.BILLING_INTERVAL_MONTHS} Kalendermonate' in sent['body_text']
    assert 'verlängert sich automatisch' in sent['body_text']
    assert 'alle anfallenden Steuern inbegriffen' in sent['body_text']


def test_verification_email_manual_points_to_billing_section_for_subscription_and_redeem(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123')
    assert 'Billing section' in sent['body_text']
    assert 'redeem a code' in sent['body_text']
    sent_de = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123', language='de')
    assert 'Abrechnung' in sent_de['body_text']
    assert 'Code' in sent_de['body_text']


def test_verification_email_manual_distinguishes_cancel_from_account_deletion(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123')
    assert 'Cancelling stops future renewals only' in sent['body_text']
    assert "access you've already paid for stays available" in sent['body_text']
    assert 'Deleting your account instead ends access immediately' in sent['body_text']
    sent_de = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123', language='de')
    assert 'beendet nur zukünftige Verlängerungen' in sent_de['body_text']
    assert 'Löschen deines Kontos beendet den Zugang dagegen sofort' in sent_de['body_text']


def test_verification_email_manual_states_adult_account_not_minimum_age_or_parent(monkeypatch):
    """Must describe an adult-owned account with a child playing *under*
    that adult's own account/consent — never phrase this as "18 OR a
    minor with parental permission to register their own account", which
    is not the actual policy (see static/terms.html / index.html's
    auth.consentAdultOrGuardian checkbox copy)."""
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123')
    assert 'Accounts are for adults (18+)' in sent['body_text']
    assert "using a parent's/guardian's own registered account" in sent['body_text']
    sent_de = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123', language='de')
    assert 'Konten sind für Erwachsene (ab 18 Jahren)' in sent_de['body_text']


def test_verification_email_manual_states_password_change_revokes_other_sessions(monkeypatch):
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123')
    assert 'Changing your password immediately signs you out of all other active sessions' in sent['body_text']
    sent_de = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123', language='de')
    assert 'Passwortänderung meldet dich sofort von allen anderen aktiven Sitzungen ab' in sent_de['body_text']


def test_verification_email_manual_never_claims_a_last_two_weeks_leaderboard_window(monkeypatch):
    """The backend's models.get_leaderboard() deliberately does NOT filter
    by recency (all-time high scores) -- the email must not claim
    otherwise, and must clarify grade-year grouping is not an age check."""
    sent = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123')
    assert 'last 2 weeks' not in sent['body_text']
    assert 'not an age check' in sent['body_text']
    sent_de = _capture(monkeypatch)
    mailer.send_verification_email('user@example.com', 'alice', 'tok123', language='de')
    assert 'letzte 2 Wochen' not in sent_de['body_text']
    assert 'nicht einer Altersprüfung' in sent_de['body_text']


def test_verification_email_manual_never_mentions_a_free_trial():
    """A separate audit incorrectly suggested adding 'start a free trial /
    contact us for a trial' language -- there is no such offering anywhere
    in this codebase (no general free trial exists), so this must never
    be added to the copy."""
    for language in ('en', 'de'):
        copy = mailer._VERIFICATION_COPY[language]
        lowered = (copy['subject'] + copy['body']).lower()
        assert 'free trial' not in lowered
        assert 'trial' not in lowered
        assert 'contact us' not in lowered


def test_verification_email_manual_does_not_duplicate_full_legal_declarations():
    """The durable contract-confirmation email (send_contract_confirmation_email)
    already carries the full legally-binding declaration/withdrawal text;
    the welcome email's product manual deliberately stays a concise
    product-facts summary and must not re-embed that separate email's
    long-form legal boilerplate (e.g. the Muster-Widerrufsformular
    heading only appears in the withdrawal-instructions snapshot)."""
    for language in ('en', 'de'):
        body = mailer._VERIFICATION_COPY[language]['body']
        assert 'Muster-Widerrufsformular' not in body
        assert 'withdraw from this contract' not in body
        assert 'Widerrufsrecht' not in body


def test_email_boundary_matches_entitlements_free_level_cutoff():
    """Cross-check against app/entitlements.py's actual gate (level <= 2 is
    free) rather than merely hoping the email text and the real gate
    agree."""
    import inspect
    from sites.ffm.app import entitlements
    source = inspect.getsource(entitlements.require_level_access)
    assert 'level <= 2' in source
