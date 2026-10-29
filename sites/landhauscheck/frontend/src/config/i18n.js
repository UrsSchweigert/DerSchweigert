// ⚠️  i18n: When adding or changing ANY user-visible text, update ALL THREE
//          language blocks below (de, en, pt) to keep them in sync.
//          Supported languages: de (German), en (English), pt (Portuguese).

export const SUPPORTED_LANGS = ["de", "en", "pt"];
export const LANG_LABELS = { de: "DE", en: "EN", pt: "PT" };

/** Read persisted language; fall back to browser language, then "de". */
export function detectLang() {
  const stored = localStorage.getItem("lhc_lang");
  if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
  const browser = navigator.language?.split("-")[0];
  if (SUPPORTED_LANGS.includes(browser)) return browser;
  return "de";
}

/** Persist the chosen language. */
export function persistLang(lang) {
  localStorage.setItem("lhc_lang", lang);
}

// ⚠️  i18n: Keep all three language blocks in sync when making text changes.
export const translations = {
  de: {
    appTagline: "Dein lokales Dashboard",
    appDesc:
      "Schön, dass du dabei bist! Landhauscheck zeigt dir auf einen Blick alles, " +
      "was du für deinen Standort brauchst: aktuelles Wetter, Bahnhöfe und Abfahrtszeiten " +
      "in der Nähe, Sehenswürdigkeiten, deinen Abfallkalender und eine Verkehrskarte – " +
      "ohne Anmeldung, kostenlos.",
    consentText:
      "Ich bin einverstanden, dass zur Darstellung der Inhalte mein Standort an " +
      "Google Maps, HERE Technologies und weitere Dienste übertragen wird. Ich habe die",
    privacyLink: "Datenschutzerklärung",
    consentSuffix: "gelesen.",
    pickerTitle: "Standort wählen",
    pickerAriaLabel: "Standort wählen",
    pickerBodyDenied:
      "Der Standortzugriff wurde verweigert. Gib deinen Standort manuell ein oder " +
      "erlaube den Zugriff in den Browser-Einstellungen.",
    pickerBodyDefault:
      "Standort konnte nicht automatisch ermittelt werden. Gib deinen Standort manuell ein.",
    gpsBtn: "📡 Standort automatisch ermitteln",
    searchPlaceholder: "Adresse, Stadt oder Postleitzahl…",
    searchBtn: "Suchen",
    consentHint: "Bitte stimme der Datenweitergabe oben zu, um den Standort zu wählen.",
    noResult: "Kein Ergebnis gefunden. Bitte eine andere Schreibweise versuchen.",
    searchError: "Suche fehlgeschlagen. Bitte Internetverbindung prüfen.",
    impressum: "Impressum",
    help: "Hilfe",
    datenschutz: "Datenschutz",
    releaseNotes: "Neuigkeiten",
    donate: "Unterstützen ❤️",
    liveError: "Fehler",
    liveLoading: "lädt…",
    liveUpdateIn: (val, unit) => `Update in ${val}${unit}`,
    // Widget titles
    transitTitle: "Verbindungen",
    routingTitle: "Nächste Bahnhöfe",
    poiTitle: "In der Nähe",
    garbageTitle: "Abfallkalender",
    // Widget status messages
    locating: "Standort wird ermittelt\u2026",
    searching: "Suche läuft\u2026",
    loadingDates: "Lade Abholtermine \u2026",
    tapToClose: "Tippen zum Schließen",
    transitNoStops: (r) => `Keine Haltestellen innerhalb ${r}\u00a0m.`,
    routingNoStations: "Keine Bahnhöfe innerhalb 20\u00a0km.",
    poiNoPlaces: (km) => `Keine Orte in ${km}\u00a0km gefunden.`,
    poiFilterAll: "Alle",
    poiFilterFoodDrink: "Essen & Trinken",
    poiFilterEssential: "Einrichtungen",
    poiFilterShopping: "Einkaufen",
    poiFilterCulture: "Kultur",
    // Dates
    today: "heute",
    tomorrow: "morgen",
    inDays: (n) => `in ${n} Tagen`,
    dateLocale: "de-DE",
    moonPhaseLabel: "Mondphase",
    // Rail type labels
    railLabels: { rail: "Bahn", halt: "Bahn", tram: "Straßenbahn", subway: "U-Bahn", light_rail: "S-Bahn", funicular: "Bahn", narrow_gauge: "Bahn" },
    now: "jetzt",
    bannerTagline: "alles nah",
    // Widget help texts (⚠️ i18n: keep all 3 language blocks in sync)
    transitTabBus: "Bus",
    transitTabRail: "Bahn",
    transitHelp: "Zeigt Bus- und Bahnverbindungen in der Nähe. Bus: Haltestellen mit Abfahrtszeiten. Bahn: Bahnhöfe mit nächsten Verbindungen. Tippe auf eine Haltestelle für Navigation.",
    routingHelp: "Zeigt Bahnhöfe in der Nähe mit den nächsten Verbindungen. Tippe auf einen Bahnhof für eine Kartenansicht mit Route.",
    poiHelp: "Sehenswürdigkeiten, Restaurants und Orte in der Nähe. Tippe auf einen Eintrag für eine Route auf der Karte.",
    restroomTitle: "Öffentliche WCs",
    restroomHelp: "Zeigt die nächsten öffentlich zugänglichen Toiletten. Tippe auf einen Eintrag für eine Fußweg-Route.",
    restroomPublicToilet: "Öffentliche Toilette",
    restroomFee: "kostenpflichtig",
    restroomFree: "kostenlos",
    restroomNoResults: (km) => `Keine öffentlichen Toiletten in ${km}\u00a0km gefunden.`,
    garbageHelp: "Nächste Abholtermine für Restmüll, Bio, Papier und Wertstoffe für deinen Standort.",
    // Fuel price overlay (⚠️ i18n: keep all 3 language blocks in sync)
    fuelTitle: "Günstigste Tankstellen",
    fuelOpen: "geöffnet",
    fuelClosed: "geschlossen",
    fuelNoData: "k.A.",
    fuelLastUpdated: "Quelle: Tankerkönig / MTS-K",
    fuelNoStations: "Keine Tankstellen in der Nähe gefunden.",
    // EV charger overlay (⚠️ i18n: keep all 3 language blocks in sync)
    chargerTitle: "Ladestationen",
    chargerNoStations: "Keine Ladestationen in der Nähe gefunden.",
    tabTraffic: "Verkehr",
    swipeHintFuel: "Tankstellen",
    swipeHintCharger: "Ladestationen",
    swipeHintToilet: "Toiletten",
    swipeHintAtm: "Geldautomaten",
    toiletNoResults: "Keine Toiletten in der Nähe gefunden.",
    atmNoResults: "Keine Geldautomaten in der Nähe gefunden.",
    back: "Zurück",
    // Navigation prompt (⚠️ i18n: keep all 3 language blocks in sync)
    navPromptTitle: "In Navigations-App öffnen",
    navOpen: "Navigation starten",
    navCancel: "Abbrechen",
    // Welcome / onboarding screen
    welcomeGetTitle: "Was du bekommst",
    welcomeShareTitle: "Standort freigeben",
    welcomeShareBody: "Damit alle Widgets mit deinen lokalen Daten arbeiten, gib deinen Standort frei.",
    clockTitle: "Uhr & Wetter",
    mapTitle: "Karte",
    featureGarbageDesc: "Nächste Abholtermine für Müll & Recycling – oder eigenen Kalender beisteuern",
    featureClockDesc: "Uhrzeit, Datum, Wetter & Mondphase",
    featureMapDesc: "Live-Stau, Tankstellen, E-Ladepunkte, Toiletten & Geldautomaten",
    featureRoutingDesc: "Züge & Verbindungen in Echtzeit",
    featureTransitDesc: "Haltestellen & nächste Abfahrtszeiten in der Nähe",
    featurePoiDesc: "Restaurants, Sehenswürdigkeiten & Orte in der Nähe",
    soloProjectNote: "Dies ist ein Solo-Projekt und der Betrieb kostet etwas. Ich mag aber weder Abonnements noch Vorauszahlungen. Wenn dir das Projekt gefällt und du es nutzt, freue ich mich sehr über einen ",
    soloProjectCoffee: "Kaffee",
    resetBtn: "Standort oder Zustimmung ändern",
    // Push notification opt-in (⚠️ i18n: keep all 3 language blocks in sync)
    notifEnable: "Abfall-Erinnerungen aktivieren (17:00 & 20:00 Uhr)",
    notifEnabled: "Abfall-Erinnerungen aktiv – 17:00 & 20:00 Uhr",
    notifDenied: "Benachrichtigungen blockiert – bitte in den Browser-Einstellungen freigeben",
    notifGrantedToast: "🔔 Erinnerungen aktiviert – du wirst um 17:00 & 20:00 Uhr benachrichtigt",
    notifIOSTip: "🔔 Aktiviert! Damit die Erinnerung ankommt: App um 17:00 und 20:00 Uhr geöffnet lassen – iOS kann sie nicht im Hintergrund senden.",
    calExportBtn: "Abholtermine zum Kalender hinzufügen",
    calExportedTitle: "Abholtermine wurden zum Kalender hinzugefügt",
    calPickerTitle: "📅 Abholtermine zum Kalender hinzufügen",
    calPickerOpenPage: "Kalender-Anleitung öffnen",
    calPickerOpenPageHint: "Öffnet eine Seite mit Schritt-für-Schritt-Anleitung für dein Gerät",
    calPickerCancel: "Abbrechen",
    // Waste calendar contribution (⚠️ i18n: keep all 3 language blocks in sync)
    wasteContributeTitle: "Kein Kalender für deinen Standort",
    wasteContributeBody:
      "Hilf uns, die Abdeckung zu verbessern! Lade eine .ics-Datei von deinem"
      + " Entsorger hoch – nach unserer Prüfung wird sie für andere Nutzer in"
      + " deiner Nähe verfügbar.",
    wasteContributeBtn: "📂 .ics-Datei hochladen",
    wasteContributing: "Überprüfe und erstelle Pull Request…",
    wasteContributeSuccess: "Danke! Dein Kalender wird geprüft und freigeschaltet.",
    wasteContributePRLink: "Pull Request ansehen",
    wasteContributeError: "Upload fehlgeschlagen. Bitte erneut versuchen.",
    wasteContributeInvalid:
      "Ungültige ICS-Datei. Bitte eine Datei von deinem Abfallbetrieb hochladen.",
    wasteContributeFiletypeHint: "Nur .ics-Dateien · max. 1 MB",
    // Expired calendar flow
    wasteExpiredMsg: "Alle Abholtermine sind abgelaufen.",
    wasteUpdateTitle: "Kalender aktualisieren",
    wasteUpdateBody:
      "Der Kalender für deinen Standort ist abgelaufen. Lade eine neue .ics-Datei"
      + " von deinem Entsorger hoch – nach Prüfung wird er sofort aktiviert.",
    wasteUpdateSuccess: "Danke! Der aktualisierte Kalender wird geprüft und freigeschaltet.",
    wasteUpdateTriggerBtn: "↑ Kalender aktualisieren",
    // Tomorrow collection banner
    wasteTomorrowAlert: (summaries) => `🗑️ Morgen wird abgeholt: ${summaries}`,
  },

  en: {
    appTagline: "Your local dashboard",
    appDesc:
      "We're glad you're here! Landhauscheck gives you everything at a glance – " +
      "current weather, nearby train stations and departure times, points of interest, " +
      "your waste calendar and a live traffic map. All for your location, no account required.",
    consentText:
      "I agree that my location will be shared with Google Maps, HERE Technologies " +
      "and other services to display local content. I have read the",
    privacyLink: "privacy policy",
    consentSuffix: "",
    pickerTitle: "Choose location",
    pickerAriaLabel: "Choose location",
    pickerBodyDenied:
      "Location access was denied. Enter your location manually or allow access " +
      "in your browser settings.",
    pickerBodyDefault:
      "Location could not be detected automatically. Please enter your location manually.",
    gpsBtn: "📡 Detect location automatically",
    searchPlaceholder: "Address, city or postal code…",
    searchBtn: "Search",
    consentHint: "Please agree to data sharing above to select a location.",
    noResult: "No results found. Please try a different spelling.",
    searchError: "Search failed. Please check your internet connection.",
    impressum: "Imprint",
    help: "Help",
    datenschutz: "Privacy",
    releaseNotes: "What's new",
    donate: "Support ❤️",
    liveError: "Error",
    liveLoading: "loading…",
    liveUpdateIn: (val, unit) => `Update in ${val}${unit}`,
    // Widget titles
    transitTitle: "Connections",
    routingTitle: "Nearest Stations",
    poiTitle: "Nearby",
    garbageTitle: "Waste Calendar",
    // Widget status messages
    locating: "Detecting location\u2026",
    searching: "Searching\u2026",
    loadingDates: "Loading collection dates\u2026",
    tapToClose: "Tap to close",
    transitNoStops: (r) => `No stops within ${r}\u00a0m.`,
    routingNoStations: "No stations within 20\u00a0km.",
    poiNoPlaces: (km) => `No places found within ${km}\u00a0km.`,
    poiFilterAll: "All",
    poiFilterFoodDrink: "Food & Drink",
    poiFilterEssential: "Facilities",
    poiFilterShopping: "Shopping",
    poiFilterCulture: "Culture",
    // Dates
    today: "today",
    tomorrow: "tomorrow",
    inDays: (n) => `in ${n} days`,
    dateLocale: "en-GB",
    moonPhaseLabel: "Moon phase",
    // Rail type labels
    railLabels: { rail: "Rail", halt: "Rail", tram: "Tram", subway: "Subway", light_rail: "Light Rail", funicular: "Rail", narrow_gauge: "Rail" },
    now: "now",
    bannerTagline: "all nearby",
    // Widget help texts (⚠️ i18n: keep all 3 language blocks in sync)
    transitTabBus: "Bus",
    transitTabRail: "Rail",
    transitHelp: "Nearby bus stops and train stations with upcoming departures. Switch between Bus and Rail tabs. Tap a stop for details and navigation.",
    routingHelp: "Train stations near you with upcoming connections. Tap a station for a map view with the route.",
    poiHelp: "Points of interest, restaurants and places nearby. Tap an entry for directions on a map.",
    restroomTitle: "Public Toilets",
    restroomHelp: "Shows the nearest publicly accessible toilets. Tap an entry for walking directions.",
    restroomPublicToilet: "Public Toilet",
    restroomFee: "fee",
    restroomFree: "free",
    restroomNoResults: (km) => `No public toilets found within ${km}\u00a0km.`,
    garbageHelp: "Next collection dates for residual waste, organic, paper and recyclables for your location.",
    // Fuel price overlay (⚠️ i18n: keep all 3 language blocks in sync)
    fuelTitle: "Cheapest fuel stations",
    fuelOpen: "open",
    fuelClosed: "closed",
    fuelNoData: "n/a",
    fuelLastUpdated: "Source: Tankerkönig / MTS-K",
    fuelNoStations: "No fuel stations found nearby.",
    // EV charger overlay (⚠️ i18n: keep all 3 language blocks in sync)
    chargerTitle: "Charging stations",
    chargerNoStations: "No charging stations found nearby.",
    tabTraffic: "Traffic",
    swipeHintFuel: "Fuel stations",
    swipeHintCharger: "Charging stations",
    swipeHintToilet: "Restrooms",
    swipeHintAtm: "ATMs",
    toiletNoResults: "No restrooms found nearby.",
    atmNoResults: "No ATMs found nearby.",
    back: "Back",
    // Navigation prompt (⚠️ i18n: keep all 3 language blocks in sync)
    navPromptTitle: "Open in navigation app",
    navOpen: "Open Navigation",
    navCancel: "Cancel",
    // Welcome / onboarding screen
    welcomeGetTitle: "What you get",
    welcomeShareTitle: "Share your location",
    welcomeShareBody: "To load local data in every widget, share your location below.",
    clockTitle: "Clock & Weather",
    mapTitle: "Map",
    featureGarbageDesc: "Next waste & recycling collection dates – or contribute your own calendar",
    featureClockDesc: "Time, date, weather & moon phase",
    featureMapDesc: "Live traffic, fuel, EV chargers, toilets & ATMs",
    featureRoutingDesc: "Trains & connections in real time",
    featureTransitDesc: "Nearby bus stops & next departures",
    featurePoiDesc: "Restaurants, sights & points of interest nearby",
    soloProjectNote: "This is a solo project and having it running does cost. However, I really do not like subscriptions or charges up front. But if you enjoy the project and find use, I would greatly appreciate a ",
    soloProjectCoffee: "coffee",
    resetBtn: "Change location or consent",
    // Push notification opt-in (⚠️ i18n: keep all 3 language blocks in sync)
    notifEnable: "Enable waste reminders (17:00 & 20:00)",
    notifEnabled: "Waste reminders active – 17:00 & 20:00",
    notifDenied: "Notifications blocked – please allow them in browser settings",
    notifGrantedToast: "🔔 Reminders enabled – you’ll be notified at 17:00 & 20:00",
    notifIOSTip: "🔔 Enabled! To receive the reminder, keep the app open at 17:00 and 20:00 – iOS cannot send notifications in the background.",
    calExportBtn: "Add collection dates to calendar",
    calExportedTitle: "Collection dates added to calendar",
    calPickerTitle: "📅 Add collection dates to calendar",
    calPickerOpenPage: "Open calendar instructions",
    calPickerOpenPageHint: "Opens a page with step-by-step instructions for your device",
    calPickerCancel: "Cancel",
    // Waste calendar contribution (⚠️ i18n: keep all 3 language blocks in sync)
    wasteContributeTitle: "No calendar for your location",
    wasteContributeBody:
      "Help us improve coverage! Upload an .ics file from your local waste provider –"
      + " after review it will be available for other users near you.",
    wasteContributeBtn: "📂 Upload .ics file",
    wasteContributing: "Validating and opening pull request…",
    wasteContributeSuccess: "Thank you! Your calendar is pending review and will go live soon.",
    wasteContributePRLink: "View pull request",
    wasteContributeError: "Upload failed. Please try again.",
    wasteContributeInvalid:
      "Invalid ICS file. Please upload a file exported from your waste provider.",
    wasteContributeFiletypeHint: ".ics files only · max 1 MB",
    // Expired calendar flow
    wasteExpiredMsg: "All collection dates have expired.",
    wasteUpdateTitle: "Update calendar",
    wasteUpdateBody:
      "The calendar for your location has expired. Upload an updated .ics file"
      + " from your waste provider – it will go live after review.",
    wasteUpdateSuccess: "Thank you! The updated calendar is pending review and will go live soon.",
    wasteUpdateTriggerBtn: "↑ Update calendar",
    // Tomorrow collection banner
    wasteTomorrowAlert: (summaries) => `🗑️ Tomorrow's collection: ${summaries}`,
  },

  pt: {
    appTagline: "O seu painel local",
    appDesc:
      "Ficamos contentes por estar aqui! O Landhauscheck mostra de relance tudo o que " +
      "precisa para a sua localização: tempo actual, estações de comboio e horários de " +
      "partida, pontos de interesse, calendário de resíduos e mapa de tráfego em directo – " +
      "sem registo, totalmente gratuito.",
    consentText:
      "Concordo que a minha localização seja partilhada com o Google Maps, HERE " +
      "Technologies e outros serviços para apresentar conteúdo local. Li a",
    privacyLink: "política de privacidade",
    consentSuffix: "",
    pickerTitle: "Escolher localização",
    pickerAriaLabel: "Escolher localização",
    pickerBodyDenied:
      "O acesso à localização foi negado. Introduza a sua localização manualmente " +
      "ou permita o acesso nas definições do browser.",
    pickerBodyDefault:
      "A localização não pôde ser detectada automaticamente. Por favor introduza a " +
      "sua localização manualmente.",
    gpsBtn: "📡 Detectar localização automaticamente",
    searchPlaceholder: "Endereço, cidade ou código postal…",
    searchBtn: "Pesquisar",
    consentHint:
      "Por favor aceite a partilha de dados acima para seleccionar uma localização.",
    noResult: "Nenhum resultado encontrado. Por favor tente uma grafia diferente.",
    searchError: "Pesquisa falhou. Por favor verifique a sua ligação à internet.",
    impressum: "Aviso Legal",
    help: "Ajuda",
    datenschutz: "Privacidade",
    releaseNotes: "Novidades",
    donate: "Apoiar ❤️",
    liveError: "Erro",
    liveLoading: "a carregar…",
    liveUpdateIn: (val, unit) => `Actualiz. em ${val}${unit}`,
    // Widget titles
    transitTitle: "Ligações",
    routingTitle: "Estações Mais Próximas",
    poiTitle: "Nas Proximidades",
    garbageTitle: "Calendário de Resíduos",
    // Widget status messages
    locating: "A detectar localização\u2026",
    searching: "A pesquisar\u2026",
    loadingDates: "A carregar datas de recolha\u2026",
    tapToClose: "Toque para fechar",
    transitNoStops: (r) => `Nenhuma paragem num raio de ${r}\u00a0m.`,
    routingNoStations: "Nenhuma estação num raio de 20\u00a0km.",
    poiNoPlaces: (km) => `Nenhum lugar encontrado num raio de ${km}\u00a0km.`,
    poiFilterAll: "Todos",
    poiFilterFoodDrink: "Comer & Beber",
    poiFilterEssential: "Serviços",
    poiFilterShopping: "Compras",
    poiFilterCulture: "Cultura",
    // Dates
    today: "hoje",
    tomorrow: "amanhã",
    inDays: (n) => `em ${n} dias`,
    dateLocale: "pt-PT",
    moonPhaseLabel: "Fase da lua",
    // Rail type labels
    railLabels: { rail: "Comboio", halt: "Comboio", tram: "Eléctrico", subway: "Metro", light_rail: "Metropolitano Ligeiro", funicular: "Comboio", narrow_gauge: "Comboio" },
    now: "agora",
    bannerTagline: "tudo perto",
    // Widget help texts (⚠️ i18n: keep all 3 language blocks in sync)
    transitTabBus: "Autocarro",
    transitTabRail: "Comboio",
    transitHelp: "Paragens de autocarro e estações de comboio próximas com partidas em tempo real. Alterne entre Autocarro e Comboio. Toque numa paragem para navegar.",
    routingHelp: "Estações de comboio próximas com as próximas ligações. Toque numa estação para ver o mapa com a rota.",
    poiHelp: "Pontos de interesse, restaurantes e locais próximos. Toque num local para ver a rota no mapa.",
    restroomTitle: "WCs Públicos",
    restroomHelp: "Mostra as casas de banho públicas mais próximas. Toque num local para obter indicações a pé.",
    restroomPublicToilet: "Casa de Banho Pública",
    restroomFee: "pago",
    restroomFree: "grátis",
    restroomNoResults: (km) => `Nenhuma casa de banho pública encontrada num raio de ${km}\u00a0km.`,
    garbageHelp: "Próximas datas de recolha de resíduos sólidos, orgânicos, papel e recicláveis para a sua localização.",
    // Fuel price overlay (⚠️ i18n: keep all 3 language blocks in sync)
    fuelTitle: "Postos mais baratos",
    fuelOpen: "aberto",
    fuelClosed: "fechado",
    fuelNoData: "n/d",
    fuelLastUpdated: "Fonte: Tankerkönig / MTS-K",
    fuelNoStations: "Nenhum posto encontrado perto de si.",
    // EV charger overlay (⚠️ i18n: keep all 3 language blocks in sync)
    chargerTitle: "Estações de carregamento",
    chargerNoStations: "Nenhuma estação de carregamento encontrada perto de si.",
    tabTraffic: "Tráfego",
    swipeHintFuel: "Postos de combustível",
    swipeHintCharger: "Estações de carregamento",
    swipeHintToilet: "WCs",
    swipeHintAtm: "Multibanco",
    toiletNoResults: "Nenhum WC encontrado nas proximidades.",
    atmNoResults: "Nenhum Multibanco encontrado nas proximidades.",
    back: "Voltar",
    // Navigation prompt (⚠️ i18n: keep all 3 language blocks in sync)
    navPromptTitle: "Abrir em navegação",
    navOpen: "Abrir navegação",
    navCancel: "Cancelar",
    // Welcome / onboarding screen
    welcomeGetTitle: "O que recebe",
    welcomeShareTitle: "Partilhar localização",
    welcomeShareBody: "Para carregar dados locais em cada widget, partilhe a sua localização abaixo.",
    clockTitle: "Relógio & Tempo",
    mapTitle: "Mapa",
    featureGarbageDesc: "Próximas datas de recolha de resíduos & reciclagem – ou contribua com o seu calendário",
    featureClockDesc: "Hora, data, tempo & fase da lua",
    featureMapDesc: "Tráfego, combustível, carregadores, WCs & multibanco",
    featureRoutingDesc: "Comboios e conexões em tempo real",
    featureTransitDesc: "Paragens de autocarro e próximas partidas",
    featurePoiDesc: "Restaurantes, pontos de interesse & locais próximos",
    soloProjectNote: "Este é um projeto a solo e mantê-lo em funcionamento tem custos. Não gosto de subscrições nem de cobranças antecipadas. Mas se gostar do projeto e lhe for útil, agradecia muito um ",
    soloProjectCoffee: "café",
    resetBtn: "Alterar localização ou consentimento",
    // Push notification opt-in (⚠️ i18n: keep all 3 language blocks in sync)
    notifEnable: "Activar lembretes de recolha (17:00 & 20:00)",
    notifEnabled: "Lembretes de recolha activos – 17:00 & 20:00",
    notifDenied: "Notificações bloqueadas – por favor permita nas definições do browser",
    notifGrantedToast: "🔔 Lembretes activados – será notificado às 17:00 & 20:00",
    notifIOSTip: "🔔 Activado! Para receber o lembrete, mantenha a app aberta às 17:00 e às 20:00 – o iOS não pode enviar notificações em segundo plano.",
    calExportBtn: "Adicionar datas de recolha ao calendário",
    calExportedTitle: "Datas de recolha adicionadas ao calendário",
    calPickerTitle: "📅 Adicionar datas de recolha ao calendário",
    calPickerOpenPage: "Abrir instruções do calendário",
    calPickerOpenPageHint: "Abre uma página com instruções passo a passo para o seu dispositivo",
    calPickerCancel: "Cancelar",
    // Waste calendar contribution (⚠️ i18n: keep all 3 language blocks in sync)
    wasteContributeTitle: "Sem calendário para a sua localização",
    wasteContributeBody:
      "Ajude-nos a melhorar a cobertura! Faça o upload de um ficheiro .ics do seu"
      + " operador de resíduos – após revisão ficará disponível para outros utilizadores perto de si.",
    wasteContributeBtn: "📂 Carregar ficheiro .ics",
    wasteContributing: "A validar e a criar pull request…",
    wasteContributeSuccess: "Obrigado! O seu calendário está pendente de revisão e ficará disponível em breve.",
    wasteContributePRLink: "Ver pull request",
    wasteContributeError: "Upload falhou. Por favor tente novamente.",
    wasteContributeInvalid:
      "Ficheiro ICS inválido. Por favor carregue um ficheiro exportado pelo seu operador de resíduos.",
    wasteContributeFiletypeHint: "Apenas ficheiros .ics · máx. 1 MB",
    // Expired calendar flow
    wasteExpiredMsg: "Todas as datas de recolha expiraram.",
    wasteUpdateTitle: "Actualizar calendário",
    wasteUpdateBody:
      "O calendário para a sua localização expirou. Carregue um ficheiro .ics"
      + " actualizado do seu operador de resíduos – ficará disponível após revisão.",
    wasteUpdateSuccess: "Obrigado! O calendário actualizado está pendente de revisão e ficará disponível em breve.",
    wasteUpdateTriggerBtn: "↑ Actualizar calendário",
    // Tomorrow collection banner
    wasteTomorrowAlert: (summaries) => `🗑️ Recolha amanhã: ${summaries}`,
  },
};
