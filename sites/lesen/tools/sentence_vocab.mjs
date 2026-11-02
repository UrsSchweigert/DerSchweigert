/**
 * Curated, semantically checked vocabulary for generate_sentences.mjs.
 *
 * Every subject carries ability groups (H human, A land animal, Fm farm animal,
 * B bird, Sw swimmer, Hop hopper, Fly flyer, Si singer, S snail, W fish,
 * F frog). A verb lists complements per group; the first group of the rule that
 * the subject belongs to wins, so a verb is only ever combined with things that
 * make sense for that kind of subject. "$diet", "$drink" and "$sound" refer to
 * per-subject data. An empty string means the verb stands alone.
 */

const DE = (() => {
  const garden = ["im Garten", "im Park", "im Wald", "auf der Wiese", "auf dem Feld"];
  const weather = ["im Schnee", "im Regen", "in der Sonne"];
  const wild = ["im Garten", "im Wald", "auf der Wiese", "auf dem Feld", ...weather];
  const outdoor = [...garden, "am See", "am Fluss", "auf dem Berg", ...weather];
  const home = ["im Haus", "im Zimmer", "am Tisch", "auf dem Sofa", "im Bett"];
  const sub = (t, g, o = {}) => ({ t, g, diet: [], drink: [], sound: "", ...o });
  const person = (t) => sub(t, ["H", "Sw", "Hop"]);
  const water = ["Wasser"];
  const subjects = [
    ...["Lisa", "Mama", "Papa", "Tim", "Anna", "Emma", "Ben", "Mia", "Oma", "Opa", "Max", "Tom", "Lea",
      "Nina", "Sara", "Leo", "Finn", "Ida", "Paul", "Lena", "Jan", "Hanna", "das Kind", "der Mann", "die Frau"].map(person),
    sub("der Hund", ["Pl", "A", "Sw"], { diet: ["Fleisch", "Wurst", "Brot"], drink: water, sound: "bellt" }),
    sub("die Katze", ["Pl", "A"], { diet: ["Fisch", "Fleisch"], drink: ["Wasser", "Milch"], sound: "miaut" }),
    sub("das Pferd", ["A", "Fm"], { diet: ["Gras", "Heu", "Hafer", "Möhren", "einen Apfel"], drink: water, sound: "wiehert" }),
    sub("die Maus", ["Pl", "A"], { diet: ["Käse", "Brot", "Nüsse", "Körner"], drink: water, sound: "piept" }),
    sub("die Kuh", ["A", "Fm"], { diet: ["Gras", "Heu"], drink: water, sound: "muht" }),
    sub("das Schaf", ["A", "Fm"], { diet: ["Gras", "Heu"], drink: water, sound: "blökt" }),
    sub("der Bär", ["A", "Sw"], { diet: ["Honig", "Beeren", "Fisch"], drink: water, sound: "brummt" }),
    sub("der Fuchs", ["A"], { diet: ["Beeren", "Fleisch"], drink: water }),
    sub("der Hase", ["Pl", "A", "Hop"], { diet: ["Gras", "Möhren", "Klee"], drink: water }),
    sub("der Esel", ["A", "Fm"], { diet: ["Gras", "Heu", "Möhren"], drink: water }),
    sub("die Ziege", ["A", "Fm"], { diet: ["Gras", "Heu", "Blätter"], drink: water, sound: "meckert" }),
    sub("das Lamm", ["Pl", "A", "Fm", "Hop"], { diet: ["Gras", "Heu"], drink: ["Wasser", "Milch"], sound: "blökt" }),
    sub("der Igel", ["A"], { diet: ["Käfer", "Würmer", "Äpfel"], drink: water }),
    sub("der Löwe", ["A"], { diet: ["Fleisch"], drink: water, sound: "brüllt" }),
    sub("das Reh", ["A"], { diet: ["Gras", "Blätter", "Beeren"], drink: water }),
    sub("der Hahn", ["A", "Fm"], { diet: ["Körner", "Brot", "Würmer"], drink: water, sound: "kräht" }),
    sub("das Huhn", ["A", "Fm"], { diet: ["Körner", "Brot", "Würmer"], drink: water, sound: "gackert" }),
    sub("der Vogel", ["B", "Fly", "Si"], { diet: ["Körner", "Würmer", "Beeren", "Brot"], drink: water, sound: "zwitschert" }),
    sub("die Ente", ["B", "Fly", "Sw"], { diet: ["Brot", "Körner", "Gras"], drink: water, sound: "quakt" }),
    sub("die Eule", ["B", "Fly"], { drink: water }),
    sub("die Taube", ["B", "Fly"], { diet: ["Körner", "Brot"], drink: water, sound: "gurrt" }),
    sub("die Biene", ["B", "Fly"], { sound: "summt" }),
    sub("die Schnecke", ["S"], { diet: ["Blätter", "Salat"] }),
    sub("der Fisch", ["W", "Sw"]),
    sub("der Frosch", ["F", "Sw", "Hop"], { diet: ["Fliegen"], sound: "quakt" }),
  ];
  const humanOutdoor = [...outdoor, "am Meer"];
  const farm = [...wild, "im Stall"];
  const verbs = [
    { v: "schläft", c: { H: [...home, "im Garten", "in der Sonne", "tief", ""], Fm: [...farm, "tief", ""], A: [...wild, "tief", ""], B: ["im Garten", "im Wald", ""], S: ["im Garten", ""], F: ["am Teich", ""] } },
    { v: "sitzt", c: { H: [...home, ...garden.slice(0, 2), "auf der Wiese", "am See", "am Fluss", "in der Sonne", ""], Fm: [...farm, "am Fluss", ""], A: [...wild, "am Fluss", ""], B: ["im Garten", "im Park", "im Wald", "auf der Wiese", "am See", "in der Sonne", ""], S: ["im Garten", "im Regen", "auf dem Weg", ""], F: ["am See", "am Teich", "am Fluss", "im Regen", ""] } },
    { v: "steht", c: { H: ["am Tisch", "im Haus", ...outdoor], Fm: [...farm, "auf dem Berg", ""], A: [...wild, "auf dem Berg", ""] } },
    { v: "spielt", c: { H: ["im Haus", "im Zimmer", ...outdoor, "am Meer", "mit dem Ball", "mit dem Hund", "mit der Katze", "Fußball", ""], Pl: [...wild, "mit dem Ball", ""] } },
    { v: "tanzt", c: { H: ["im Zimmer", "im Haus", "im Garten", "im Park", "auf der Wiese", "im Regen", "in der Sonne", "schön", ""] } },
    { v: "rennt", c: { H: [...humanOutdoor, "nach Hause", ""], A: [...wild, "auf dem Berg", "am Fluss", "nach Hause", ""] } },
    { v: "geht", c: { H: [...humanOutdoor, "zur Schule", "nach Hause", "zum Markt", "zum See", ""], A: [...wild, "nach Hause", "zum See", "zum Fluss", ""] } },
    { v: "lacht", c: { H: ["im Garten", "im Haus", "im Zimmer", "im Park", "am Tisch", "auf dem Sofa", "in der Schule", "laut", "leise", "viel", ""] } },
    { v: "weint", advOnly: ["jetzt", "heute", "manchmal"], c: { H: ["im Bett", "im Zimmer", "im Haus", "leise", "laut", ""] } },
    { v: "arbeitet", c: { H: ["im Garten", "im Haus", "am Tisch", "im Wald", "auf dem Feld", "in der Schule", "im Stall", "viel", ""] } },
    { v: "singt", c: { H: ["ein Lied", "im Garten", "im Haus", "im Zimmer", "im Park", "in der Schule", "im Wald", "auf der Wiese", "am See", "laut", "leise", "schön", ""], Si: ["im Garten", "im Wald", "im Park", "auf der Wiese", "am See", "in der Sonne", "laut", "schön", ""] } },
    { v: "malt", c: { H: ["ein Bild", "eine Blume", "ein Haus", "einen Baum", "eine Sonne", "einen Fisch", "einen Hund", "eine Katze", "ein Pferd", "einen Vogel", "am Tisch", "im Zimmer", "in der Schule", "im Garten", "im Park", ""] } },
    { v: "liest", c: { H: ["ein Buch", "einen Brief", "eine Karte", "ein Heft", "eine Geschichte", "ein Märchen", "im Bett", "auf dem Sofa", "im Garten", "im Park", "in der Schule", "am Tisch", "im Zimmer", ""] } },
    { v: "lernt", c: { H: ["lesen", "schreiben", "rechnen", "singen", "malen", "schwimmen", "in der Schule", "am Tisch", "im Zimmer", "viel", ""] } },
    { v: "kocht", c: { H: ["Suppe", "Reis", "Tee", "Kakao", "Nudeln", "Kartoffeln", "Gemüse", "Eier", "im Haus", "in der Küche"] } },
    { v: "backt", c: { H: ["Brot", "Kuchen", "Brötchen", "Kekse", "eine Torte", "einen Apfelkuchen", "im Haus", "in der Küche"] } },
    { v: { H: "isst", default: "frisst" }, c: { H: ["einen Apfel", "eine Birne", "Brot", "Kuchen", "Suppe", "Reis", "Nudeln", "Obst", "Gemüse", "Kekse", "Eier", "Salat", "eine Banane", "eine Orange", "Käse", "Fisch", "am Tisch", "im Garten", "im Park", "in der Küche"], A: ["$diet"], B: ["$diet"], F: ["$diet"], S: ["$diet"] } },
    { v: "trinkt", c: { H: ["Wasser", "Milch", "Tee", "Kakao", "Saft", "am Tisch", "im Garten", "in der Küche"], A: ["$drink", "am See", "am Fluss"], B: ["$drink", "am See", "am Fluss"] } },
    { v: "bringt", c: { H: ["ein Buch", "einen Brief", "ein Geschenk", "einen Korb", "Brot", "Milch", "einen Ball", "eine Blume", "einen Apfel", "Kuchen", "Tee"] } },
    { v: "holt", c: { H: ["Wasser", "Brot", "Milch", "einen Ball", "ein Buch", "einen Korb", "Holz", "einen Apfel", "Eier", "eine Jacke"] } },
    { v: "kauft", c: { H: ["Brot", "Milch", "einen Ball", "ein Buch", "eine Blume", "einen Apfel", "Obst", "Eier", "Käse", "Kuchen", "Saft", "eine Jacke"] } },
    { v: "pflanzt", c: { H: ["eine Blume", "einen Baum", "Kartoffeln", "Bohnen", "Erbsen", "Möhren", "Salat", "Rüben", "einen Busch"] } },
    { v: "erntet", c: { H: ["Äpfel", "Birnen", "Bohnen", "Erbsen", "Kartoffeln", "Möhren", "Nüsse", "Beeren", "Salat"] } },
    { v: "zählt", c: { H: ["Äpfel", "Schafe", "Birnen", "Blumen", "Eier", "Enten", "Kühe", "Tauben", "Sterne", "Kekse", "Bälle"] } },
    { v: "öffnet", c: { H: ["eine Tür", "ein Fenster", "ein Buch", "einen Brief", "ein Tor", "eine Kiste", "ein Heft"] } },
    { v: "wäscht", c: { H: ["einen Apfel", "eine Birne", "Wäsche", "Gemüse", "einen Teller", "eine Tasse", "ein Auto", "den Hund"] } },
    { v: "macht", c: { H: ["Kuchen", "Tee", "ein Bild", "Musik", "Hausaufgaben", "einen Plan", "ein Foto", "Pause", "Brot"] } },
    { v: "sieht", c: { H: ["einen Vogel", "eine Maus", "einen Hund", "die Sonne", "einen Fisch", "einen Baum", "ein Pferd", "ein Haus", "den Mond", "einen Stern", "eine Wolke"], A: ["einen Baum", "die Sonne", "den Mond", "einen Ball", "ein Kind", "einen Stern", "eine Wolke"], B: ["einen Baum", "die Sonne", "den Mond", "ein Kind", "einen Stern", "eine Wolke"] } },
    { v: "hört", c: { H: ["ein Lied", "einen Vogel", "Musik", "einen Hahn", "den Regen", "den Wind", "eine Glocke", "einen Hund"], A: ["ein Lied", "den Regen", "den Wind", "eine Glocke", "ein Kind", "Musik"], B: ["den Regen", "den Wind", "eine Glocke", "ein Kind", "Musik"] } },
    { v: "sucht", c: { H: ["einen Ball", "ein Buch", "einen Brief", "einen Schuh", "eine Blume", "einen Apfel", "einen Stein", "einen Hut", "eine Jacke"], A: ["$diet", "Wasser"], B: ["$diet", "Wasser"], S: ["$diet"], F: ["$diet"] } },
    { v: "findet", c: { H: ["einen Ball", "ein Buch", "einen Brief", "einen Schuh", "eine Blume", "einen Apfel", "einen Stein", "einen Hut", "eine Jacke"], A: ["$diet", "Wasser"], B: ["$diet", "Wasser"], S: ["$diet"], F: ["$diet"] } },
    { v: "wartet", c: { H: ["im Haus", "im Garten", "im Park", "am Tisch", "am See", "auf den Bus", "auf den Zug", "auf das Essen", ""], A: [...wild, ""], B: ["im Garten", "im Wald", ""], S: ["im Garten", ""], F: ["am See", ""] } },
    { v: "ruht", c: { H: ["im Bett", "auf dem Sofa", "im Garten", "im Park", "im Zimmer", "am See", "in der Sonne", ""], Fm: [...farm, ""], A: [...wild, ""], B: ["im Garten", "im Wald", "in der Sonne", ""], S: ["im Garten", ""], F: ["am See", "am Teich", ""] } },
    { v: "schwimmt", c: { Sw: ["im See", "im Meer", "im Fluss", "im Teich", ""] } },
    { v: "springt", c: { F: ["in den Teich", "in den See", "ins Wasser", "auf ein Blatt", ""], H: ["im Garten", "auf der Wiese", "im Park", "auf dem Feld", "im Schnee", "im Regen", "in den See", "ins Wasser", "über den Bach", "über den Zaun", ""], Hop: ["im Garten", "auf der Wiese", "auf dem Feld", "im Park", "im Wald", "im Schnee", "im Regen", "in der Sonne", ""] } },
    { v: "hüpft", c: { Hop: ["im Garten", "auf der Wiese", "auf dem Feld", "im Park", "im Wald", "im Schnee", "im Regen", "in der Sonne", ""] } },
    { v: "fliegt", c: { Fly: ["über die Wiese", "über den See", "über das Feld", "über den Wald", "über das Haus", "über den Berg", "im Garten", "im Park", "in der Sonne", "hoch", "weit", ""] } },
    { v: "kriecht", c: { S: ["im Garten", "auf der Wiese", "im Wald", "im Regen", "auf dem Weg", "langsam", ""] } },
    { v: "lebt", c: { W: ["im See", "im Teich", "im Fluss", "im Meer"], F: ["am Teich", "im Teich", "am See"], S: ["im Garten", "im Wald"] } },
    { v: "$sound", c: { any: ["", "laut", "leise", "im Garten", "im Wald", "auf der Wiese", "im Regen"] } },
  ];
  return { subjects, verbs, adverbs: ["heute", "jetzt", "oft", "morgen", "immer", "manchmal"].map((w) => ({ w, pos: "verb" })), places: { wild, farm } };
})();

const EN = (() => {
  const garden = ["in the garden", "in the park", "in the woods", "on the meadow", "in the field"];
  const weather = ["in the snow", "in the rain", "in the sun"];
  const wild = ["in the garden", "in the woods", "on the meadow", "in the field", ...weather];
  const outdoor = [...garden, "at the lake", "at the river", "on the hill", ...weather];
  const home = ["in the house", "in the room", "at the table", "on the sofa", "in bed"];
  const sub = (t, g, o = {}) => ({ t, g, diet: [], drink: [], sound: "", ...o });
  const person = (t) => sub(t, ["H", "Sw", "Hop"]);
  const water = ["water"];
  const subjects = [
    ...["Lisa", "Mom", "Dad", "Tim", "Anna", "Emma", "Ben", "Mia", "Grandma", "Grandpa", "Max", "Tom", "Lea",
      "Nina", "Sara", "Leo", "Finn", "Ida", "Paul", "Lena", "Jan", "Hannah", "the kid", "the man", "the woman"].map(person),
    sub("the dog", ["Pl", "A", "Sw"], { diet: ["meat", "sausage", "bread"], drink: water, sound: "barks" }),
    sub("the cat", ["Pl", "A"], { diet: ["fish", "meat"], drink: ["water", "milk"], sound: "meows" }),
    sub("the horse", ["A", "Fm"], { diet: ["grass", "hay", "oats", "carrots", "an apple"], drink: water, sound: "neighs" }),
    sub("the mouse", ["Pl", "A"], { diet: ["cheese", "bread", "nuts", "seeds"], drink: water, sound: "squeaks" }),
    sub("the cow", ["A", "Fm"], { diet: ["grass", "hay"], drink: water, sound: "moos" }),
    sub("the sheep", ["A", "Fm"], { diet: ["grass", "hay"], drink: water, sound: "bleats" }),
    sub("the bear", ["A", "Sw"], { diet: ["honey", "berries", "fish"], drink: water, sound: "growls" }),
    sub("the fox", ["A"], { diet: ["berries", "meat"], drink: water }),
    sub("the rabbit", ["Pl", "A", "Hop"], { diet: ["grass", "carrots", "clover"], drink: water }),
    sub("the donkey", ["A", "Fm"], { diet: ["grass", "hay", "carrots"], drink: water }),
    sub("the goat", ["A", "Fm"], { diet: ["grass", "hay", "leaves"], drink: water, sound: "bleats" }),
    sub("the lamb", ["Pl", "A", "Fm", "Hop"], { diet: ["grass", "hay"], drink: ["water", "milk"], sound: "bleats" }),
    sub("the hedgehog", ["A"], { diet: ["beetles", "worms", "apples"], drink: water }),
    sub("the lion", ["A"], { diet: ["meat"], drink: water, sound: "roars" }),
    sub("the deer", ["A"], { diet: ["grass", "leaves", "berries"], drink: water }),
    sub("the rooster", ["A", "Fm"], { diet: ["seeds", "bread", "worms"], drink: water, sound: "crows" }),
    sub("the hen", ["A", "Fm"], { diet: ["seeds", "bread", "worms"], drink: water, sound: "clucks" }),
    sub("the bird", ["B", "Fly", "Si"], { diet: ["seeds", "worms", "berries", "bread"], drink: water, sound: "tweets" }),
    sub("the duck", ["B", "Fly", "Sw"], { diet: ["bread", "seeds", "grass"], drink: water, sound: "quacks" }),
    sub("the owl", ["B", "Fly"], { drink: water }),
    sub("the dove", ["B", "Fly"], { diet: ["seeds", "bread"], drink: water, sound: "coos" }),
    sub("the bee", ["B", "Fly"], { sound: "buzzes" }),
    sub("the snail", ["S"], { diet: ["leaves", "lettuce"] }),
    sub("the fish", ["W", "Sw"]),
    sub("the frog", ["F", "Sw", "Hop"], { diet: ["flies"], sound: "croaks" }),
  ];
  const humanOutdoor = [...outdoor, "at the beach"];
  const farm = [...wild, "in the barn"];
  const verbs = [
    { v: "sleeps", c: { H: [...home, "in the garden", "in the sun", "deeply", ""], Fm: [...farm, "deeply", ""], A: [...wild, "deeply", ""], B: ["in the garden", "in the woods", ""], S: ["in the garden", ""], F: ["at the pond", ""] } },
    { v: "sits", c: { H: [...home, "in the garden", "in the park", "on the meadow", "at the lake", "at the river", "in the sun", ""], Fm: [...farm, "at the river", ""], A: [...wild, "at the river", ""], B: ["in the garden", "in the park", "in the woods", "on the meadow", "at the lake", "in the sun", ""], S: ["in the garden", "in the rain", "on the path", ""], F: ["at the lake", "at the pond", "at the river", "in the rain", ""] } },
    { v: "stands", c: { H: ["at the table", "in the house", ...outdoor], Fm: [...farm, "on the hill", ""], A: [...wild, "on the hill", ""] } },
    { v: "plays", c: { H: ["in the house", "in the room", ...outdoor, "at the beach", "with a ball", "with the dog", "with the cat", "football", ""], Pl: [...wild, "with a ball", ""] } },
    { v: "dances", c: { H: ["in the room", "in the house", "in the garden", "in the park", "on the meadow", "in the rain", "in the sun", "well", ""] } },
    { v: "runs", c: { H: [...humanOutdoor.filter((x) => !x.startsWith("at ")), "home", ""], A: [...wild, "on the hill", "at the river", "home", ""] } },
    { v: "goes", c: { H: [...humanOutdoor.filter((x) => !x.startsWith("at ") && x !== "in the sun"), "to school", "home", "to the market", "to the lake", ""], A: [...wild, "home", "to the lake", "to the river", ""] } },
    { v: "laughs", c: { H: ["in the garden", "in the house", "in the room", "in the park", "at the table", "on the sofa", "at school", "loudly", "softly", ""] } },
    { v: "cries", advOnly: ["now", "today", "sometimes"], c: { H: ["in bed", "in the room", "in the house", "softly", "loudly", ""] } },
    { v: "works", c: { H: ["in the garden", "in the house", "at the table", "in the woods", "in the field", "at school", "in the barn", "hard", ""] } },
    { v: "sings", c: { H: ["a song", "in the garden", "in the house", "in the room", "in the park", "at school", "in the woods", "on the meadow", "loudly", "softly", "well", ""], Si: ["in the garden", "in the woods", "in the park", "on the meadow", "at the lake", "in the sun", "loudly", "well", ""] } },
    { v: "paints", c: { H: ["a picture", "a flower", "a house", "a tree", "a sun", "a fish", "a dog", "a cat", "a horse", "a bird", "at the table", "in the room", "at school", "in the garden", "in the park", ""] } },
    { v: "reads", c: { H: ["a book", "a letter", "a card", "a story", "a fairy tale", "in bed", "on the sofa", "in the garden", "in the park", "at school", "at the table", "in the room", ""] } },
    { v: "learns", c: { H: ["to read", "to write", "to count", "to sing", "to paint", "to swim", "at school", "at the table", "in the room", "a lot", ""] } },
    { v: "cooks", c: { H: ["soup", "rice", "pasta", "potatoes", "vegetables", "eggs", "in the house", "in the kitchen"] } },
    { v: "bakes", c: { H: ["bread", "cake", "rolls", "cookies", "a pie", "an apple cake", "in the house", "in the kitchen"] } },
    { v: "eats", c: { H: ["an apple", "a pear", "bread", "cake", "soup", "rice", "pasta", "fruit", "vegetables", "cookies", "eggs", "salad", "a banana", "an orange", "cheese", "fish", "at the table", "in the garden", "in the park", "in the kitchen"], A: ["$diet"], B: ["$diet"], F: ["$diet"], S: ["$diet"] } },
    { v: "drinks", c: { H: ["water", "milk", "tea", "cocoa", "juice", "at the table", "in the garden", "in the kitchen"], A: ["$drink", "at the lake", "at the river"], B: ["$drink", "at the lake", "at the river"] } },
    { v: "brings", c: { H: ["a book", "a letter", "a gift", "a basket", "bread", "milk", "a ball", "a flower", "an apple", "cake", "tea"] } },
    { v: "fetches", c: { H: ["water", "bread", "milk", "a ball", "a book", "a basket", "wood", "an apple", "eggs", "a jacket"] } },
    { v: "buys", c: { H: ["bread", "milk", "a ball", "a book", "a flower", "an apple", "fruit", "eggs", "cheese", "cake", "juice", "a jacket"] } },
    { v: "plants", c: { H: ["a flower", "a tree", "potatoes", "beans", "peas", "carrots", "lettuce", "turnips", "a bush"] } },
    { v: "harvests", c: { H: ["apples", "pears", "beans", "peas", "potatoes", "carrots", "nuts", "berries", "lettuce"] } },
    { v: "counts", c: { H: ["apples", "sheep", "pears", "flowers", "eggs", "ducks", "cows", "doves", "stars", "cookies", "balls"] } },
    { v: "opens", c: { H: ["a door", "a window", "a book", "a letter", "a gate", "a box", "a notebook"] } },
    { v: "washes", c: { H: ["an apple", "a pear", "clothes", "vegetables", "a plate", "a cup", "a car", "the dog"] } },
    { v: "makes", c: { H: ["cake", "tea", "a picture", "music", "a plan", "bread"] } },
    { v: "sees", c: { H: ["a bird", "a mouse", "a dog", "the sun", "a fish", "a tree", "a horse", "a house", "the moon", "a star", "a cloud"], A: ["a tree", "the sun", "the moon", "a ball", "a kid", "a star", "a cloud"], B: ["a tree", "the sun", "the moon", "a kid", "a star", "a cloud"] } },
    { v: "hears", c: { H: ["a song", "a bird", "music", "a rooster", "the rain", "the wind", "a bell", "a dog"], A: ["a song", "the rain", "the wind", "a bell", "a kid", "music"], B: ["the rain", "the wind", "a bell", "a kid", "music"] } },
    { v: "looks for", c: { H: ["a ball", "a book", "a letter", "a shoe", "a flower", "an apple", "a stone", "a hat", "a jacket"], A: ["$diet", "water"], B: ["$diet", "water"], S: ["$diet"], F: ["$diet"] } },
    { v: "finds", c: { H: ["a ball", "a book", "a letter", "a shoe", "a flower", "an apple", "a stone", "a hat", "a jacket"], A: ["$diet", "water"], B: ["$diet", "water"], S: ["$diet"], F: ["$diet"] } },
    { v: "waits", c: { H: ["in the house", "in the garden", "in the park", "at the table", "at the lake", "for the bus", "for the train", "for lunch", ""], A: [...wild, ""], B: ["in the garden", "in the woods", ""], S: ["in the garden", ""], F: ["at the lake", ""] } },
    { v: "rests", c: { H: ["in bed", "on the sofa", "in the garden", "in the park", "in the room", "at the lake", "in the sun", ""], Fm: [...farm, ""], A: [...wild, ""], B: ["in the garden", "in the woods", "in the sun", ""], S: ["in the garden", ""], F: ["at the lake", "at the pond", ""] } },
    { v: "swims", c: { Sw: ["in the lake", "in the sea", "in the river", "in the pond", ""] } },
    { v: "jumps", c: { F: ["into the pond", "into the lake", "into the water", "on a leaf", ""], H: ["in the garden", "on the meadow", "in the park", "in the field", "in the snow", "in the rain", "into the lake", "into the water", "over the brook", "over the fence", ""], Hop: ["in the garden", "on the meadow", "in the field", "in the park", "in the woods", "in the snow", "in the rain", "in the sun", ""] } },
    { v: "hops", c: { Hop: ["in the garden", "on the meadow", "in the field", "in the park", "in the woods", "in the snow", "in the rain", "in the sun", ""] } },
    { v: "flies", c: { Fly: ["over the meadow", "over the lake", "over the field", "over the woods", "over the house", "over the hill", "in the garden", "in the park", "in the sun", "high", "far", ""] } },
    { v: "crawls", c: { S: ["in the garden", "on the meadow", "in the woods", "in the rain", "on the path", "slowly", ""] } },
    { v: "lives", c: { W: ["in the lake", "in the pond", "in the river", "in the sea"], F: ["at the pond", "in the pond", "at the lake"], S: ["in the garden", "in the woods"] } },
    { v: "$sound", c: { any: ["", "loudly", "softly", "in the garden", "in the woods", "on the meadow", "in the rain"] } },
  ];
  const adverbs = [{ w: "today", pos: "end" }, { w: "now", pos: "end" }, { w: "often", pos: "pre" }, { w: "tomorrow", pos: "end" }, { w: "always", pos: "pre" }, { w: "sometimes", pos: "pre" }];
  return { subjects, verbs, adverbs };
})();

export const VOCAB = { de: DE, en: EN };
