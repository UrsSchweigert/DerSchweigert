"""Transactional email sending via SES v1 (not SESv2 — kept consistent
with using the simplest boto3 client API for this small set of plain-text
transactional emails).

Reads APP_BASE_URL / SES_SENDER_EMAIL / SES_CONFIGURATION_SET /
BETA_WAITLIST_NOTIFY_EMAIL from os.environ at call time (not at import
time) so tests can override them per-test via monkeypatch/os.environ,
matching how app/models.py reads DYNAMODB_USERS_TABLE.
"""
import os

import boto3


def _ses_client():
    return boto3.client(
        'ses',
        region_name=os.environ.get('AWS_DEFAULT_REGION', 'eu-central-1'),
    )


def _sender():
    return os.environ.get('SES_SENDER_EMAIL', 'no-reply@ffm.derschweigert.de')


def _base_url():
    return os.environ.get('APP_BASE_URL', 'https://ffm.derschweigert.de')


def _configuration_set():
    return os.environ.get('SES_CONFIGURATION_SET', '')


def _beta_waitlist_notify_address():
    return os.environ.get('BETA_WAITLIST_NOTIFY_EMAIL', '')


def _send(to_email, subject, body_text):
    """Send a plain-text email. Callers are expected to wrap this in
    try/except so a transient SES failure doesn't 500 the whole request —
    this function itself does not swallow errors, it just performs the send."""
    kwargs = {
        'Source': _sender(),
        'Destination': {'ToAddresses': [to_email]},
        'Message': {
            'Subject': {'Data': subject, 'Charset': 'UTF-8'},
            'Body': {'Text': {'Data': body_text, 'Charset': 'UTF-8'}},
        },
    }
    # Tagging the send with our configuration set is what lets CloudWatch
    # track Send/Bounce/Complaint/Reject counts and the alarms in
    # infra/terraform/sites/ffm/main.tf actually fire. Omitted (rather than
    # sent as an empty string) when unset, since SES rejects an empty
    # ConfigurationSetName — local/dev/test runs simply aren't tracked.
    configuration_set = _configuration_set()
    if configuration_set:
        kwargs['ConfigurationSetName'] = configuration_set
    _ses_client().send_email(**kwargs)


#: Fixed boilerplate for send_verification_email, keyed by the locale the
#: user had selected (client-side `ffm_locale`, see static/game/i18n.js)
#: when they registered/requested the resend (app/auth.py passes this
#: through as `language`) -- 'en' remains the fallback/default to match
#: this function's long-established pre-existing behavior for callers
#: that don't pass an (explicitly validated) locale at all.
_VERIFICATION_COPY = {
    'en': {
        'subject': "Welcome to Arithmo Slayer — verify your account",
        'body': (
            "Hi {username},\n\n"
            "Thanks for signing up for Arithmo Slayer!\n\n"
            "Arithmo Slayer is a fast-paced arcade game that turns mental math "
            "practice into a reflex challenge. Fiends march toward you carrying "
            "an arithmetic problem — solve it before the timer runs out to "
            "strike them down. It's a fun way to sharpen addition, subtraction, "
            "multiplication, and division under a bit of friendly time pressure, "
            "while competing for a spot on the leaderboard.\n\n"
            "Quick manual:\n"
            "- Pick a difficulty on the start screen: Easy (15s / 7 hearts), "
            "Medium (10s / 5 hearts), or Hard (5s / 3 hearts).\n"
            "- Each fiend shows a math problem above its head. Answer it — tap "
            "a multiple-choice button, or type the number and hit Strike! — "
            "before the timer runs out to defeat it.\n"
            "- A wrong answer or a timeout costs a heart and resets your combo "
            "streak. Run out of hearts and the run ends.\n"
            "- Chain correct answers to build a combo streak: past combo 5 you "
            "can unleash a fireball, past combo 10 a lightning bolt, and past "
            "combo 20 a dragon that can strike multiple fiends at once.\n"
            "- You'll progress through 60 levels grouped into chapters, each "
            "introducing new operations and bigger numbers — from simple "
            "addition all the way to mixed +, -, x, / problems.\n"
            "- Levels 1-2 are free forever; levels 3-60 need a Premium "
            "subscription (EUR 3.00, all applicable taxes included, charged "
            "every 3 calendar months, auto-renews) — manage your "
            "subscription or redeem a code any time from your account's "
            "Billing section.\n"
            "- Cancelling stops future renewals only: access you've already "
            "paid for stays available until the end of the current period. "
            "(Deleting your account instead ends access immediately.)\n"
            "- Accounts are for adults (18+). A child can play using a "
            "parent's/guardian's own registered account, under that adult's "
            "consent and responsibility.\n"
            "- Changing your password immediately signs you out of all "
            "other active sessions, everywhere.\n"
            "- Your best score is saved to your profile and shown on the "
            "leaderboard, optionally grouped by first grade year if you set "
            "one in your profile — that's just for comparing with "
            "similarly-aged classmates, not an age check.\n\n"
            "Please verify your email address by visiting the link below:\n"
            "{link}\n\n"
            "This link expires in 24 hours. If you didn't create this account, "
            "you can ignore this email.\n\n"
            "Have fun, and good luck slaying!\n"
        ),
    },
    'de': {
        'subject': "Willkommen bei Arithmo Slayer — bestätige dein Konto",
        'body': (
            "Hallo {username},\n\n"
            "danke, dass du dich bei Arithmo Slayer registriert hast!\n\n"
            "Arithmo Slayer ist ein temporeiches Arcade-Spiel, das Kopfrechnen "
            "in eine Reflex-Herausforderung verwandelt. Unholde marschieren mit "
            "einer Rechenaufgabe auf dich zu — löse sie, bevor der Timer "
            "abläuft, um sie zu besiegen. So trainierst du Addition, "
            "Subtraktion, Multiplikation und Division unter freundlichem "
            "Zeitdruck und misst dich mit anderen in der Bestenliste.\n\n"
            "Kurzanleitung:\n"
            "- Wähle am Startbildschirm einen Schwierigkeitsgrad: Leicht "
            "(15s / 7 Herzen), Mittel (10s / 5 Herzen) oder Schwer "
            "(5s / 3 Herzen).\n"
            "- Jeder Unhold zeigt eine Rechenaufgabe über seinem Kopf. "
            "Beantworte sie — tippe eine Mehrfachauswahl-Antwort an oder "
            "gib die Zahl ein und drücke Angriff! — bevor der Timer abläuft, "
            "um ihn zu besiegen.\n"
            "- Eine falsche Antwort oder ein Timeout kostet ein Herz und setzt "
            "deine Combo-Serie zurück. Sind alle Herzen aufgebraucht, endet "
            "der Lauf.\n"
            "- Reihe richtige Antworten zu einer Combo-Serie: ab Combo 5 "
            "kannst du einen Feuerball einsetzen, ab Combo 10 einen Blitz und "
            "ab Combo 20 einen Drachen, der mehrere Unholde gleichzeitig "
            "treffen kann.\n"
            "- Du durchläufst 60 Level in mehreren Kapiteln, die jeweils neue "
            "Rechenarten und größere Zahlen einführen — von einfacher Addition "
            "bis zu gemischten +, -, x, /-Aufgaben.\n"
            "- Level 1-2 sind dauerhaft kostenlos; Level 3-60 benötigen ein "
            "Premium-Abonnement (3,00 EUR, alle anfallenden Steuern "
            "inbegriffen, fällig alle 3 Kalendermonate, verlängert sich "
            "automatisch) — verwalte dein Abo oder löse einen Code jederzeit "
            "im Bereich „Abrechnung\" deines Kontos ein.\n"
            "- Eine Kündigung beendet nur zukünftige Verlängerungen: bereits "
            "bezahlter Zugang bleibt bis zum Ende des aktuellen Zeitraums "
            "bestehen. (Das Löschen deines Kontos beendet den Zugang dagegen "
            "sofort.)\n"
            "- Konten sind für Erwachsene (ab 18 Jahren). Ein Kind kann über "
            "das eigene, auf einen Elternteil/Erziehungsberechtigten "
            "registrierte Konto spielen, mit dessen Zustimmung und "
            "Verantwortung.\n"
            "- Eine Passwortänderung meldet dich sofort von allen anderen "
            "aktiven Sitzungen ab.\n"
            "- Deine Bestleistung wird in deinem Profil gespeichert und in "
            "der Bestenliste angezeigt, optional gruppiert nach "
            "Einschulungsjahr, falls du eines hinterlegt hast — das dient nur "
            "dem Vergleich mit Gleichaltrigen, nicht einer Altersprüfung.\n\n"
            "Bitte bestätige deine E-Mail-Adresse über den folgenden Link:\n"
            "{link}\n\n"
            "Dieser Link läuft in 24 Stunden ab. Falls du dieses Konto nicht "
            "erstellt hast, kannst du diese E-Mail ignorieren.\n\n"
            "Viel Spaß und viel Erfolg beim Kämpfen!\n"
        ),
    },
}


def send_verification_email(to_email, username, token, language='en'):
    resolved = language if language in _VERIFICATION_COPY else 'en'
    copy = _VERIFICATION_COPY[resolved]
    link = f"{_base_url()}/?verify_token={token}&lang={resolved}"
    _send(
        to_email,
        subject=copy['subject'],
        body_text=copy['body'].format(username=username, link=link),
    )


#: Fixed boilerplate for send_password_reset_email, same locale-selection
#: reasoning as _VERIFICATION_COPY above ('en' is the pre-existing default).
_PASSWORD_RESET_COPY = {
    'en': {
        'subject': "Reset your Arithmo Slayer password",
        'body': (
            "Hi {username},\n\n"
            "We received a request to reset your password. Visit the link below "
            "to choose a new one:\n"
            "{link}\n\n"
            "This link expires in 1 hour. If you didn't request this, "
            "you can ignore this email.\n"
        ),
    },
    'de': {
        'subject': "Setze dein Arithmo-Slayer-Passwort zurück",
        'body': (
            "Hallo {username},\n\n"
            "wir haben eine Anfrage zum Zurücksetzen deines Passworts erhalten. "
            "Besuche den folgenden Link, um ein neues Passwort festzulegen:\n"
            "{link}\n\n"
            "Dieser Link läuft in 1 Stunde ab. Falls du dies nicht angefordert "
            "hast, kannst du diese E-Mail ignorieren.\n"
        ),
    },
}


def send_password_reset_email(to_email, username, token, language='en'):
    resolved = language if language in _PASSWORD_RESET_COPY else 'en'
    copy = _PASSWORD_RESET_COPY[resolved]
    link = f"{_base_url()}/?reset_token={token}&lang={resolved}"
    _send(
        to_email,
        subject=copy['subject'],
        body_text=copy['body'].format(username=username, link=link),
    )


def send_cancel_request_ack_email(to_email, request_id, submitted_at, outcome, outcome_detail=None, language='de'):
    """Manual, operator-triggered acknowledgement for a processed public
    cancellation request (app/cancel_requests.py / billing-admin
    `cancel-request complete-email`). Never sent automatically on
    submission — only after a human operator has reviewed the request and
    run `cancel-request process` or `cancel-request record-manual-outcome`,
    so this always describes a real, already-recorded outcome rather than
    an assumption.

    `outcome_detail` is the exact dict durably stored alongside the
    outcome (see app/cancel_requests_store.py's finalize()/
    record_manual_outcome()) — this function surfaces its actually-
    recorded fields (e.g. a manual record's `effective_date`/
    `provider_reference`, or an automated record's `cancel_at_period_end`)
    rather than only ever repeating the generic per-outcome text, and it
    never claims the requester's originally-requested date was honored —
    only what was actually configured/recorded.

    `language` should be the SAME locale that was captured on the
    original public submission (app/cancel_requests_store.py's `locale`
    field), never the operator's own current locale when they happen to
    run the CLI — see app/billing_admin.py's `cancel-request
    complete-email` command. 'de' remains the pre-existing default for
    callers that don't pass an (explicitly validated) locale at all,
    matching this function's long-established German-only behavior.
    The existing German body text keeps this module's established
    ASCII-safe spelling convention (e.g. "Kuendigung", not "Kündigung");
    only locale *selection* is new here.
    """
    if outcome not in ('fulfilled', 'no_subscription'):
        # No silent fallback to a vague "Ihre Anfrage wurde bearbeitet."
        # for an outcome this function doesn't actually know how to
        # describe truthfully — callers must fix the outcome value
        # instead of this email quietly saying something non-committal.
        raise ValueError(f'unknown_outcome: {outcome!r}')
    resolved = language if language in ('de', 'en') else 'de'
    detail = outcome_detail or {}
    detail_lines = []
    if resolved == 'de':
        if detail.get('manual'):
            if detail.get('effective_date'):
                detail_lines.append(f"Tatsaechlich konfiguriertes Datum: {detail['effective_date']}")
            if detail.get('provider_reference'):
                detail_lines.append(f"Referenz: {detail['provider_reference']}")
            if detail.get('note'):
                detail_lines.append(f"Anmerkung des Mitarbeiters: {detail['note']}")
        elif outcome == 'fulfilled':
            if detail.get('subscription_id'):
                detail_lines.append(f"Abonnement-Referenz: {detail['subscription_id']}")
            if 'cancel_at_period_end' in detail:
                detail_lines.append(
                    'Kuendigung zum Ende des aktuellen Abrechnungszeitraums: '
                    + ('Ja' if detail['cancel_at_period_end'] else 'Nein')
                )
        outcome_text = {
            'fulfilled': (
                'Ihr Abonnement wurde fuer zukuenftige Verlaengerungen gekuendigt. '
                'Bereits bezahlter Zugang bleibt bis zum Ende des laufenden Abrechnungszeitraums bestehen.'
            ),
            'no_subscription': (
                'Zum Zeitpunkt der Bearbeitung war fuer die von Ihnen angegebenen Daten kein '
                'aktives Abonnement vorhanden. Falls Sie glauben, dass dies ein Irrtum ist, '
                'antworten Sie bitte auf diese E-Mail.'
            ),
        }[outcome]
        if detail_lines:
            outcome_text = outcome_text + '\n' + '\n'.join(detail_lines)
        _send(
            to_email,
            subject=f"Ihre Kuendigungsanfrage {request_id} wurde bearbeitet",
            body_text=(
                f"Hallo,\n\n"
                f"wir bestaetigen den Abschluss der manuellen Bearbeitung Ihrer am "
                f"{submitted_at} (UTC) eingereichten Kuendigungsanfrage.\n"
                f"Antrags-ID: {request_id}\n\n"
                f"Ergebnis: {outcome_text}\n\n"
                f"Diese Bestaetigung wurde nach manueller Pruefung durch einen Mitarbeiter "
                f"versendet, nicht automatisch bei Eingang Ihrer Anfrage.\n"
            ),
        )
        return
    # English.
    if detail.get('manual'):
        if detail.get('effective_date'):
            detail_lines.append(f"Actually configured date: {detail['effective_date']}")
        if detail.get('provider_reference'):
            detail_lines.append(f"Reference: {detail['provider_reference']}")
        if detail.get('note'):
            detail_lines.append(f"Staff note: {detail['note']}")
    elif outcome == 'fulfilled':
        if detail.get('subscription_id'):
            detail_lines.append(f"Subscription reference: {detail['subscription_id']}")
        if 'cancel_at_period_end' in detail:
            detail_lines.append(
                'Cancels at the end of the current billing period: '
                + ('Yes' if detail['cancel_at_period_end'] else 'No')
            )
    outcome_text = {
        'fulfilled': (
            'Your subscription was canceled for future renewals. Access you have already '
            'paid for remains available until the end of the current billing period.'
        ),
        'no_subscription': (
            'At the time this request was processed, no active subscription was found for '
            'the details you provided. If you believe this is a mistake, please reply to '
            'this email.'
        ),
    }[outcome]
    if detail_lines:
        outcome_text = outcome_text + '\n' + '\n'.join(detail_lines)
    _send(
        to_email,
        subject=f"Your cancellation request {request_id} has been processed",
        body_text=(
            f"Hello,\n\n"
            f"we confirm the completed manual processing of your cancellation request "
            f"submitted on {submitted_at} (UTC).\n"
            f"Request ID: {request_id}\n\n"
            f"Outcome: {outcome_text}\n\n"
            f"This confirmation was sent after manual review by a staff member, not "
            f"automatically upon receipt of your request.\n"
        ),
    )


#: Fixed boilerplate (never the legally-binding declaration/terms text
#: itself, which is always pulled from the confirmation snapshot's own
#: per-language fields) for send_contract_confirmation_email, keyed by the
#: SAME language the purchaser actually selected/accepted at checkout
#: (confirmation['declarations']['language']) -- never a UI/browser
#: default guessed independently of that persisted selection.
_CONTRACT_CONFIRMATION_COPY = {
    'de': {
        'greeting': 'Hallo,',
        'intro': (
            'vielen Dank fuer Ihr Abonnement von Arithmo Slayer Premium. Diese E-Mail '
            'bestaetigt den Abschluss und die Bereitstellung Ihres digitalen Inhalts.'
        ),
        'reference_label': 'Vertragsreferenz',
        'confirmed_label': 'Bestaetigt am (UTC)',
        'declarations_heading': 'Ihre bei Vertragsschluss abgegebenen Erklaerungen:',
        'declarations_detail': 'Version: {version}, Sprache: {language}, abgegeben am (UTC): {accepted_at}',
        'subject': 'Bestaetigung Ihres Arithmo Slayer Premium-Abonnements',
        'footer': (
            'Bei Fragen antworten Sie bitte auf diese E-Mail oder schreiben Sie an '
            'info@derschweigert.de.'
        ),
    },
    'en': {
        'greeting': 'Hello,',
        'intro': (
            'Thank you for subscribing to Arithmo Slayer Premium. This email confirms the '
            'conclusion and provision of your digital content.'
        ),
        'reference_label': 'Contract reference',
        'confirmed_label': 'Confirmed at (UTC)',
        'declarations_heading': 'The declarations you made when concluding the contract:',
        'declarations_detail': 'Version: {version}, language: {language}, accepted at (UTC): {accepted_at}',
        'subject': 'Confirmation of your Arithmo Slayer Premium subscription',
        'footer': (
            'If you have any questions, please reply to this email or write to '
            'info@derschweigert.de.'
        ),
    },
}


def send_contract_confirmation_email(to_email, confirmation):
    """Durable contract-confirmation email for a NEW, server-verified-paid
    subscription (see app/billing.py `_ensure_contract_confirmation`).
    Sent at most once per subscription/contract -- renewals never call
    this again.

    Contains the actual confirmed-content snapshot in the email body
    itself (contract reference, price/renewal/cancellation terms, the
    full withdrawal-instructions model form, and the exact declaration
    text/version/language/timestamp the purchaser accepted) rather than
    only a link to pages whose content can change later -- a mutable
    link or a bare Stripe receipt is not sufficient durable evidence of
    what was actually disclosed and accepted at the time of this specific
    contract.

    Sent in the SAME language the purchaser actually selected and had
    durably bound at checkout (confirmation['declarations']['language']),
    never a UI/browser default guessed independently of that persisted
    selection -- the confirmation snapshot carries both a '..._de' and
    '..._en' variant of every language-dependent field precisely so this
    can pick the matching one rather than always defaulting to German.
    """
    declarations = confirmation.get('declarations') or {}
    language = declarations.get('language')
    if language not in _CONTRACT_CONFIRMATION_COPY:
        language = 'de'  # Only reached if declarations are missing entirely (see caller's error log).
    copy = _CONTRACT_CONFIRMATION_COPY[language]
    body_lines = [
        f"{copy['greeting']}\n",
        f"{copy['intro']}\n",
        f"{copy['reference_label']}: {confirmation['contract_reference']}",
        f"{copy['confirmed_label']}: {confirmation['confirmed_at']}\n",
        confirmation[f'price_and_renewal_summary_{language}'], '',
    ]
    if declarations:
        body_lines += [
            copy['declarations_heading'],
            '- ' + copy['declarations_detail'].format(
                version=declarations.get('version'), language=declarations.get('language'),
                accepted_at=declarations.get('accepted_at'),
            ),
            f"- {declarations.get('immediate_access_text')}",
            f"- {declarations.get('withdrawal_waiver_text')}",
            '',
        ]
    body_lines += [confirmation[f'withdrawal_instructions_{language}'], '']
    body_lines += [copy['footer']]
    _send(to_email, copy['subject'], '\n'.join(body_lines))


#: Fixed boilerplate for send_withdrawal_request_receipt_email, keyed by
#: the SAME statement_language the requester actually selected and had
#: durably persisted on the withdrawal-request record -- never a
#: UI/browser default guessed independently of that persisted selection.
_WITHDRAWAL_RECEIPT_COPY = {
    'de': {
        'subject': 'Eingangsbestaetigung Ihres Widerrufs {request_id}',
        'greeting': 'Hallo,',
        'intro': 'wir bestaetigen den Eingang Ihrer Widerrufserklaerung.',
        'request_id_label': 'Antrags-ID',
        'submitted_label': 'Eingereicht am (UTC)',
        'statement_label': 'Ihre Erklaerung',
        'footer': (
            'Dies ist eine Eingangsbestaetigung, keine abschliessende Entscheidung. Ein '
            'Mitarbeiter prueft Ihre Angaben manuell und meldet sich bei Bedarf unter der '
            'angegebenen Kontakt-E-Mail-Adresse.'
        ),
    },
    'en': {
        'subject': 'Receipt confirmation for your withdrawal {request_id}',
        'greeting': 'Hello,',
        'intro': 'we confirm receipt of your withdrawal declaration.',
        'request_id_label': 'Request ID',
        'submitted_label': 'Submitted at (UTC)',
        'statement_label': 'Your declaration',
        'footer': (
            'This is a receipt confirmation, not a final decision. A member of our team will '
            'manually review your details and get back to you at the contact email address '
            'provided if needed.'
        ),
    },
}


def send_withdrawal_request_receipt_email(to_email, request_id, submitted_at, statement_text, receipt_text,
                                           language='de'):
    """Immediate, durable receipt for a public /api/withdrawal-requests
    submission (app/withdrawal_requests.py). Unlike the cancellation-
    request flow's operator-triggered acknowledgement, this is sent right
    at submission time, because the withdrawal workflow's requirement is
    an immediate durable receipt -- SES accepting this send is not proof
    of inbox delivery (callers must still treat the downloadable receipt
    endpoint as the durable fallback, and durably record/retry this send
    independently -- see withdrawal_requests_store.set_receipt_email_state).

    `language` must be the requester's own persisted `statement_language`
    choice from the withdrawal-request record, never a UI/browser default
    guessed independently of it -- so a requester who deliberately chose
    the English statement also receives this receipt in English.
    `receipt_text` is caller-supplied verbatim (already in the matching
    language -- see app/withdrawal_requests.py's `_receipt_text`) and is
    only interpolated here, never re-translated.
    """
    copy = _WITHDRAWAL_RECEIPT_COPY.get(language, _WITHDRAWAL_RECEIPT_COPY['de'])
    _send(
        to_email,
        subject=copy['subject'].format(request_id=request_id),
        body_text=(
            f"{copy['greeting']}\n\n"
            f"{copy['intro']}\n\n"
            f"{copy['request_id_label']}: {request_id}\n"
            f"{copy['submitted_label']}: {submitted_at}\n\n"
            f"{copy['statement_label']}:\n{statement_text}\n\n"
            f"{receipt_text}\n\n"
            f"{copy['footer']}"
        ),
    )


#: Fixed boilerplate for send_withdrawal_request_outcome_email, keyed by
#: the requester's persisted statement_language (same reasoning as
#: _WITHDRAWAL_RECEIPT_COPY above). Operator-authored free-text detail
#: (e.g. --note) is never translated -- it is passed through verbatim in
#: whichever language the operator wrote it.
_WITHDRAWAL_OUTCOME_COPY = {
    'de': {
        'subject': 'Ihr Widerruf {request_id} wurde bearbeitet',
        'greeting': 'Hallo,',
        'intro': (
            'wir bestaetigen den Abschluss der manuellen Bearbeitung Ihrer am {submitted_at} '
            '(UTC) eingereichten Widerrufserklaerung.'
        ),
        'request_id_label': 'Antrags-ID',
        'result_label': 'Ergebnis',
        'footer': 'Diese Bestaetigung wurde nach manueller Pruefung durch einen Mitarbeiter versendet.',
        'outcome_text': {
            'fulfilled': 'Ihre Widerrufserklaerung wurde bearbeitet; Details siehe unten.',
            'no_match': (
                'Zum Zeitpunkt der Bearbeitung konnte Ihre Erklaerung keinem aktiven Vertrag '
                'zugeordnet werden. Falls Sie glauben, dass dies ein Irrtum ist, antworten Sie '
                'bitte auf diese E-Mail.'
            ),
        },
        'subscription_canceled': 'Das zugehoerige Abonnement wurde sofort beendet.',
        'refund_reference': 'Rueckerstattungsreferenz: {ref}',
        'operator_note': 'Anmerkung des Mitarbeiters: {note}',
    },
    'en': {
        'subject': 'Your withdrawal {request_id} has been processed',
        'greeting': 'Hello,',
        'intro': (
            'we confirm the completion of the manual review of your withdrawal declaration '
            'submitted on {submitted_at} (UTC).'
        ),
        'request_id_label': 'Request ID',
        'result_label': 'Result',
        'footer': 'This confirmation was sent after a manual review by a member of our team.',
        'outcome_text': {
            'fulfilled': 'Your withdrawal declaration has been processed; see details below.',
            'no_match': (
                'At the time of processing, your declaration could not be matched to an active '
                'contract. If you believe this is a mistake, please reply to this email.'
            ),
        },
        'subscription_canceled': 'The associated subscription was ended immediately.',
        'refund_reference': 'Refund reference: {ref}',
        'operator_note': 'Operator note: {note}',
    },
}


def send_withdrawal_request_outcome_email(to_email, request_id, submitted_at, outcome, outcome_detail=None,
                                           language='de'):
    """Manual, operator-triggered final-outcome email for a processed
    withdrawal request (app/billing_admin.py `withdrawal-request
    complete-email`). Mirrors send_cancel_request_ack_email's posture:
    never sent automatically, always describes an outcome an operator has
    actually already recorded, never a guess.

    `language` must be the requester's own persisted `statement_language`
    choice from the withdrawal-request record, never a UI/browser default
    guessed independently of it."""
    if outcome not in ('fulfilled', 'no_match'):
        raise ValueError(f'unknown_outcome: {outcome!r}')
    copy = _WITHDRAWAL_OUTCOME_COPY.get(language, _WITHDRAWAL_OUTCOME_COPY['de'])
    detail = outcome_detail or {}
    detail_lines = []
    if detail.get('subscription_canceled_immediately'):
        detail_lines.append(copy['subscription_canceled'])
    if detail.get('refund_provider_reference'):
        detail_lines.append(copy['refund_reference'].format(ref=detail['refund_provider_reference']))
    if detail.get('note'):
        # Operator-authored free text -- passed through verbatim, never translated.
        detail_lines.append(copy['operator_note'].format(note=detail['note']))
    outcome_text = copy['outcome_text'][outcome]
    if detail_lines:
        outcome_text = outcome_text + '\n' + '\n'.join(detail_lines)
    _send(
        to_email,
        subject=copy['subject'].format(request_id=request_id),
        body_text=(
            f"{copy['greeting']}\n\n"
            f"{copy['intro'].format(submitted_at=submitted_at)}\n"
            f"{copy['request_id_label']}: {request_id}\n\n"
            f"{copy['result_label']}: {outcome_text}\n\n"
            f"{copy['footer']}\n"
        ),
    )


#: Fixed boilerplate for send_email_change_confirmation, same locale-
#: selection reasoning as _VERIFICATION_COPY above ('en' is the pre-
#: existing default).
_EMAIL_CHANGE_CONFIRMATION_COPY = {
    'en': {
        'subject': "Confirm your new email address for Arithmo Slayer",
        'body': (
            "Hi {username},\n\n"
            "Please confirm this is your new email address by visiting the link below:\n"
            "{link}\n\n"
            "This link expires in 24 hours. If you didn't request this change, "
            "you can ignore this email — your account will keep using its current address.\n"
        ),
    },
    'de': {
        'subject': "Bestätige deine neue E-Mail-Adresse für Arithmo Slayer",
        'body': (
            "Hallo {username},\n\n"
            "bitte bestätige, dass dies deine neue E-Mail-Adresse ist, indem du "
            "den folgenden Link besuchst:\n"
            "{link}\n\n"
            "Dieser Link läuft in 24 Stunden ab. Falls du diese Änderung nicht "
            "angefordert hast, kannst du diese E-Mail ignorieren — dein Konto "
            "behält weiterhin seine aktuelle Adresse.\n"
        ),
    },
}


def send_email_change_confirmation(to_email, username, token, language='en'):
    resolved = language if language in _EMAIL_CHANGE_CONFIRMATION_COPY else 'en'
    copy = _EMAIL_CHANGE_CONFIRMATION_COPY[resolved]
    link = f"{_base_url()}/?confirm_email_token={token}&lang={resolved}"
    _send(
        to_email,
        subject=copy['subject'],
        body_text=copy['body'].format(username=username, link=link),
    )


def send_beta_waitlist_notification(email, submitted_at, locale):
    """Tell the operator that a new address joined the Android beta list.

    Operator-facing and therefore German-only, unlike the locale-selected
    user templates above. No-op when BETA_WAITLIST_NOTIFY_EMAIL is empty
    (local/dev/test default); callers are expected to swallow SES errors so
    a notification failure never fails a sign-up that is already stored.
    """
    to_email = _beta_waitlist_notify_address()
    if not to_email:
        return
    body_text = (
        "Neue Anmeldung für die Android-Beta-Liste.\n\n"
        f"E-Mail:      {email}\n"
        f"Eingetragen: {submitted_at or 'unbekannt'}\n"
        f"Sprache:     {locale}\n\n"
        "Die vollständige Liste bekommst du mit:\n"
        "python -m flask --app sites.ffm.app:create_app beta-admin export\n"
    )
    _send(to_email, subject=f"Neue Android-Beta-Anmeldung: {email}", body_text=body_text)
