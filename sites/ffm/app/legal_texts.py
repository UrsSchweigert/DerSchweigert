"""Canonical, versioned legal declaration/contract text snapshots.

These strings are the single source of truth for what a purchaser is shown
and asked to accept at checkout, and for what gets durably recorded and
emailed as the contract confirmation. The backend NEVER trusts
client-supplied declaration text — it only accepts a client-supplied
`version` + `language` selector (see app/billing.py `checkout()`) and looks
the actual text up here, so a tampered/forged declaration string can never
be durably recorded as if it were the real, reviewed wording.

Scope and legal basis (operator-confirmed, not an independent legal
determination by this code — same posture as every other legal caveat in
this repository, see README.md "Historical legal/tax review questions"):
the paid offering is treated as a contract for the supply of digital
content not on a tangible medium (Section 356 BGB; the operator has
specifically confirmed Section 356(6) BGB as the applicable immediate-
performance/withdrawal-waiver basis for this service). Nothing here
determines statutory classification independently; it only implements the
disclosures and durable record-keeping the operator approved.

Bumping DECLARATIONS_VERSION invalidates any in-flight checkout whose
client still has an older version cached (see `checkout()`'s explicit
`declaration_version_mismatch` rejection) — never bump it for a purely
cosmetic change; only bump when the actual legal wording changes, so old,
already-accepted declarations remain truthfully described by the version
that was actually shown to that purchaser.
"""

#: Bump only when the legal wording of either declaration below actually
#: changes. Format is free-form but should be sortable/traceable to a date.
DECLARATIONS_VERSION = 'checkout-declarations-v1-2026-10-16'

SUPPORTED_LANGUAGES = ('de', 'en')

#: "I expressly agree that [operator] begins providing the paid digital
#: content before the withdrawal period has expired." Required, standalone
#: checkbox -- never bundled with any other declaration.
IMMEDIATE_ACCESS_DECLARATION = {
    'de': (
        'Ich stimme ausdrücklich zu, dass Urs Schweigert vor Ablauf der '
        'Widerrufsfrist mit der Bereitstellung der kostenpflichtigen '
        'digitalen Inhalte beginnt.'
    ),
    'en': (
        'I expressly agree that Urs Schweigert begins providing the paid '
        'digital content before the withdrawal period has expired. '
        '(Non-binding translation; the German wording above/at checkout is '
        'authoritative.)'
    ),
}

#: "I am aware that by giving this consent, with the start of provision I
#: lose my right of withdrawal." Required, standalone checkbox -- never
#: bundled with the declaration above or with the unrelated adult/terms
#: checkbox.
WITHDRAWAL_WAIVER_DECLARATION = {
    'de': (
        'Mir ist bekannt, dass ich durch meine Zustimmung mit Beginn der '
        'Bereitstellung mein Widerrufsrecht verliere.'
    ),
    'en': (
        'I am aware that by giving this consent, I lose my right of '
        'withdrawal once provision of the content begins. (Non-binding '
        'translation; the German wording above/at checkout is '
        'authoritative.)'
    ),
}

#: Static operator identity, taken verbatim from static/impressum.html (§5
#: DDG) -- never invented/assumed. Used for the withdrawal-instructions
#: model form and the contract-confirmation email; keep in sync with that
#: page if it is ever updated.
OPERATOR_NAME = 'Urs Schweigert'
OPERATOR_ADDRESS_LINES = ('Am Sonnenhang 12', '85235 Pfaffenhofen a.d. Glonn', 'Deutschland')
OPERATOR_EMAIL = 'info@derschweigert.de'

#: Price/renewal facts as actually configured (see
#: app/stripe_provider.py:validate_price -- 199 cents EUR every 3 calendar
#: months -- which this text must stay consistent with).
PRICE_EUR = '1,99 EUR'
PRICE_EUR_EN = 'EUR 1.99'
BILLING_INTERVAL_MONTHS = 3


def contract_reference(subscription_id):
    """Durable, human-quotable reference for one specific contract
    (= one specific Stripe subscription). Deliberately derived from the
    provider's own subscription id rather than inventing a parallel
    numbering scheme -- it is already globally unique, durable, and is
    exactly what an operator looks up in the Stripe dashboard."""
    return f'FFM-{subscription_id}'


def price_and_renewal_summary(language):
    if language == 'en':
        return (
            f'Subscription price: {PRICE_EUR_EN}, all applicable taxes included, charged every '
            f'{BILLING_INTERVAL_MONTHS} calendar months. The subscription renews automatically for '
            f'each new {BILLING_INTERVAL_MONTHS}-month period unless cancelled before the end of the '
            'current period. Cancelling stops future renewals only; access already paid for '
            'continues until the end of the current paid period. Statutory consumer rights '
            '(including the statutory right of withdrawal, subject to the waiver below once you '
            'have given your consent and provision has begun) remain unaffected by this cancellation '
            'mechanism.'
        )
    return (
        f'Abonnementpreis: {PRICE_EUR}, alle anfallenden Steuern inbegriffen, fällig alle '
        f'{BILLING_INTERVAL_MONTHS} Kalendermonate. Das Abonnement verlängert sich automatisch für '
        f'jeden neuen {BILLING_INTERVAL_MONTHS}-Monats-Zeitraum, sofern es nicht vor Ende des '
        'aktuellen Zeitraums gekündigt wird. Eine Kündigung beendet nur zukünftige Verlängerungen; '
        'bereits bezahlter Zugang bleibt bis zum Ende des aktuellen bezahlten Zeitraums bestehen. '
        'Gesetzliche Verbraucherrechte (einschließlich eines gesetzlichen Widerrufsrechts, '
        'vorbehaltlich des nachstehenden Verzichts nach erteilter Zustimmung und Beginn der '
        'Bereitstellung) bleiben von diesem Kündigungsmechanismus unberührt.'
    )


def withdrawal_instructions_model_form(language):
    """Muster-Widerrufsformular / sample withdrawal form, using the
    verified operator identity above. Standard 14-day notice period per
    Section 355(1)/(2) BGB; statutory exceptions (including the
    Section 356 digital-content waiver a purchaser has separately and
    explicitly accepted once provision has begun) are not altered by this
    instructional text -- it describes the general right, not whether it
    still applies to any specific, already-fulfilled order."""
    address = ', '.join((OPERATOR_NAME,) + OPERATOR_ADDRESS_LINES)
    if language == 'en':
        return (
            'Right of withdrawal (standard 14-day notice; statutory exceptions, including the '
            'Section 356 BGB digital-content waiver you may have separately and explicitly '
            'accepted, are unaffected and are not re-determined by this general notice):\n\n'
            'You have the right to withdraw from this contract within 14 days without giving any '
            'reason. The withdrawal period will expire 14 days from the day of the conclusion of '
            'the contract. To exercise your right of withdrawal, you must inform us\n'
            f'({address}, e-mail: {OPERATOR_EMAIL})\n'
            'of your decision to withdraw from this contract by an unambiguous statement (e.g. by '
            'e-mail, or via the no-login withdrawal form at /widerruf.html). You may use (but are '
            'not required to use) the model withdrawal form below.\n\n'
            '--- Model withdrawal form ---\n'
            f'To {address}, {OPERATOR_EMAIL}:\n'
            'I hereby give notice that I withdraw from my contract for the supply of the following '
            'digital content: Arithmo Slayer premium subscription.\n'
            'Ordered on: ____________________\n'
            'Name of consumer: ____________________\n'
            'Address of consumer: ____________________\n'
            'Date: ____________________'
        )
    return (
        'Widerrufsrecht (regulärer 14-Tage-Hinweis; gesetzliche Ausnahmen, einschließlich eines '
        'gesondert und ausdrücklich von Ihnen akzeptierten Verzichts nach § 356 BGB für digitale '
        'Inhalte, bleiben hiervon unberührt und werden durch diesen allgemeinen Hinweis nicht neu '
        'beurteilt):\n\n'
        'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu '
        'widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsschlusses. Um '
        'Ihr Widerrufsrecht auszuüben, müssen Sie uns\n'
        f'({address}, E-Mail: {OPERATOR_EMAIL})\n'
        'mittels einer eindeutigen Erklärung (z. B. per E-Mail oder über das anmeldefreie '
        'Widerrufsformular unter /widerruf.html) über Ihren Entschluss, diesen Vertrag zu '
        'widerrufen, informieren. Sie können dafür das untenstehende Muster-Widerrufsformular '
        'verwenden, was jedoch nicht vorgeschrieben ist.\n\n'
        '--- Muster-Widerrufsformular ---\n'
        f'An {address}, {OPERATOR_EMAIL}:\n'
        'Hiermit widerrufe(n) ich/wir den von mir/uns abgeschlossenen Vertrag über die '
        'Bereitstellung der folgenden digitalen Inhalte: Arithmo Slayer Premium-Abonnement.\n'
        'Bestellt am: ____________________\n'
        'Name des/der Verbraucher(s): ____________________\n'
        'Anschrift des/der Verbraucher(s): ____________________\n'
        'Datum: ____________________'
    )


def declarations_snapshot(language):
    """The exact text shown/accepted for all three checkout declarations,
    in the given language, under the current DECLARATIONS_VERSION. Never
    built from client input."""
    return {
        'version': DECLARATIONS_VERSION,
        'language': language,
        'immediate_access_text': IMMEDIATE_ACCESS_DECLARATION[language],
        'withdrawal_waiver_text': WITHDRAWAL_WAIVER_DECLARATION[language],
    }


#: Canonical withdrawal declaration statement recorded for every
#: /api/withdrawal-requests submission (app/withdrawal_requests.py). Never
#: user-editable -- the requester is stating exactly this, not a
#: free-text claim of their own wording, so the durable record always
#: reflects an unambiguous, pre-reviewed statement.
WITHDRAWAL_STATEMENT = {
    'de': (
        'Hiermit widerrufe ich den von mir abgeschlossenen Vertrag über die Bereitstellung der '
        'kostenpflichtigen digitalen Inhalte (Arithmo Slayer Premium-Abonnement).'
    ),
    'en': (
        'I hereby withdraw from the contract I entered into for the supply of the paid digital '
        'content (Arithmo Slayer premium subscription).'
    ),
}
