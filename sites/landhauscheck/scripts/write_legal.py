"""Overwrite the two legal pages with minimal versions."""
import pathlib

IMP = pathlib.Path("sites/landhauscheck/frontend/public/impressum.html")
DSZ = pathlib.Path("sites/landhauscheck/frontend/public/datenschutz.html")

IMP.write_text(
    "<!doctype html>\n"
    '<html lang="de">\n'
    "<head>\n"
    '  <meta charset="UTF-8" />\n'
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n'
    "  <title>Impressum \u2013 Landhauscheck</title>\n"
    "  <style>\n"
    "    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n"
    "    body{min-height:100dvh;display:grid;place-items:center;padding:1.5rem;\n"
    '      font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;\n'
    "      background:radial-gradient(ellipse 70% 60% at 15% 10%,#0D47A1 0%,transparent 60%),\n"
    "        radial-gradient(ellipse 60% 55% at 85% 90%,#1565C0 0%,transparent 60%),#d0e4f7;\n"
    "      color:#1c1c1e}\n"
    "    .card{width:100%;max-width:480px;background:rgba(255,255,255,.72);\n"
    "      backdrop-filter:blur(28px) saturate(1.8);border:1px solid rgba(255,255,255,.55);\n"
    "      border-radius:22px;padding:2rem 2.4rem;box-shadow:0 8px 40px rgba(13,71,161,.18)}\n"
    "    h1{font-size:1.4rem;font-weight:700;margin-bottom:1.2rem;color:#1c1c1e}\n"
    "    p,address{font-size:.93rem;line-height:1.7;color:#3a3a3c;font-style:normal}\n"
    "    .back{display:inline-block;margin-top:1.4rem;font-size:.88rem;color:#1565C0;text-decoration:none}\n"
    "  </style>\n"
    "</head>\n"
    "<body>\n"
    '  <div class="card">\n'
    "    <h1>Impressum</h1>\n"
    "    <address>\n"
    "      Urs Schweigert<br />\n"
    "      Am Sonnenhang 12<br />\n"
    "      85235 Pfaffenhofen an der Glonn<br />\n"
    "      Deutschland<br /><br />\n"
    "      E-Mail: urs.schweigert@me.com\n"
    "    </address>\n"
    '    <a class="back" href="/">\u2190 Zur\u00fcck</a>\n'
    "  </div>\n"
    "</body>\n"
    "</html>\n",
    encoding="utf-8",
)

DSZ.write_text(
    "<!doctype html>\n"
    '<html lang="de">\n'
    "<head>\n"
    '  <meta charset="UTF-8" />\n'
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n'
    "  <title>Datenschutz \u2013 Landhauscheck</title>\n"
    "  <style>\n"
    "    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n"
    "    body{min-height:100dvh;display:grid;place-items:start center;padding:1.5rem;\n"
    '      font-family:-apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;\n'
    "      background:radial-gradient(ellipse 70% 60% at 15% 10%,#0D47A1 0%,transparent 60%),\n"
    "        radial-gradient(ellipse 60% 55% at 85% 90%,#1565C0 0%,transparent 60%),#d0e4f7;\n"
    "      color:#1c1c1e}\n"
    "    .card{width:100%;max-width:560px;margin:1.5rem auto;background:rgba(255,255,255,.72);\n"
    "      backdrop-filter:blur(28px) saturate(1.8);border:1px solid rgba(255,255,255,.55);\n"
    "      border-radius:22px;padding:2rem 2.4rem;box-shadow:0 8px 40px rgba(13,71,161,.18)}\n"
    "    h1{font-size:1.4rem;font-weight:700;margin-bottom:1rem;color:#1c1c1e}\n"
    "    h2{font-size:1rem;font-weight:600;margin:1.2rem 0 .3rem;color:#1c1c1e}\n"
    "    p,li{font-size:.9rem;line-height:1.7;color:#3a3a3c}\n"
    "    ul{margin:.3rem 0 .6rem 1.2rem}\n"
    "    .back{display:inline-block;margin-top:1.4rem;font-size:.88rem;color:#1565C0;text-decoration:none}\n"
    "    .note{font-size:.8rem;color:#6e6e73;margin-top:1.4rem}\n"
    "  </style>\n"
    "</head>\n"
    "<body>\n"
    '  <div class="card">\n'
    "    <h1>Datenschutzerkl\u00e4rung</h1>\n\n"
    "    <h2>Verantwortlicher</h2>\n"
    "    <p>Urs Schweigert, Am Sonnenhang 12, 85235 Pfaffenhofen an der Glonn<br />\n"
    "    E-Mail: urs.schweigert@me.com</p>\n\n"
    "    <h2>Verarbeitete Daten</h2>\n"
    "    <p>Zur Anzeige lokaler Inhalte wird ausschlie\u00dflich der eingegebene oder per GPS\n"
    "    ermittelte Standort (Koordinaten) verwendet. Es werden keine Namen, E-Mail-Adressen\n"
    "    oder sonstige personenbezogene Daten erhoben.</p>\n"
    "    <p>Die Koordinaten werden an folgende Drittdienste \u00fcbertragen:</p>\n"
    "    <ul>\n"
    "      <li><strong>Google Maps Platform</strong> \u2013 Karte, Ortssuche, Geocodierung (USA; EU-US DPF zertifiziert)</li>\n"
    "      <li><strong>HERE Technologies</strong> \u2013 \u00d6PNV-Abfahrten und Routenberechnung (NL)</li>\n"
    "      <li><strong>Open-Meteo</strong> \u2013 Wetterdaten (CH; keine Cookies, keine Speicherung)</li>\n"
    "    </ul>\n"
    "    <p>Der Server (AWS Irland) speichert technische Zugriffsdaten f\u00fcr max. 7 Tage.\n"
    "    Nutzungsstatistiken werden anonymisiert gespeichert (kein R\u00fcckschluss auf Personen).</p>\n\n"
    "    <h2>Einwilligung &amp; Widerruf</h2>\n"
    "    <p>Rechtsgrundlage: Art.\u00a06 Abs.\u00a01 lit.\u00a0a DSGVO (Einwilligung). Sie k\u00f6nnen Ihre\n"
    "    Einwilligung jederzeit widerrufen, indem Sie die Websitedaten f\u00fcr landhauscheck.com\n"
    "    in Ihren Browser-Einstellungen l\u00f6schen.</p>\n\n"
    "    <h2>Ihre Rechte</h2>\n"
    "    <p>Sie haben das Recht auf Auskunft, Berichtigung und L\u00f6schung (Art.\u00a015\u201317 DSGVO)\n"
    "    sowie das Recht auf Beschwerde beim Bayerischen Landesamt f\u00fcr Datenschutzaufsicht, Ansbach.\n"
    "    Kontakt: urs.schweigert@me.com</p>\n\n"
    '    <p class="note">Stand: April 2026</p>\n'
    '    <a class="back" href="/">\u2190 Zur\u00fcck</a>\n'
    "  </div>\n"
    "</body>\n"
    "</html>\n",
    encoding="utf-8",
)

print("OK")
