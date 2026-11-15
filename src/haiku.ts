// Heroku-style names for people who don't pick one: an adjective, a noun and
// a few digits, like "misty-river-4821".

const adjectives = [
  "autumn", "hidden", "bitter", "misty", "silent", "empty", "dry", "dark", "summer", "icy",
  "delicate", "quiet", "white", "cool", "spring", "winter", "patient", "twilight", "dawn",
  "crimson", "wispy", "weathered", "blue", "billowing", "broken", "cold", "damp", "falling",
  "frosty", "green", "long", "late", "lingering", "bold", "little", "morning", "muddy", "old",
  "red", "rough", "still", "small", "sparkling", "shy", "wandering", "withered", "wild",
  "black", "young", "holy", "solitary", "fragrant", "aged", "snowy", "proud", "floral",
  "restless", "divine", "polished", "ancient", "purple", "lively", "nameless"
]

const nouns = [
  "waterfall", "river", "breeze", "moon", "rain", "wind", "sea", "morning", "snow", "lake",
  "sunset", "pine", "shadow", "leaf", "dawn", "glitter", "forest", "hill", "cloud", "meadow",
  "sun", "glade", "bird", "brook", "butterfly", "bush", "dew", "dust", "field", "fire",
  "flower", "firefly", "feather", "grass", "haze", "mountain", "night", "pond", "darkness",
  "snowflake", "silence", "sound", "sky", "shape", "surf", "thunder", "violet", "water",
  "wildflower", "wave", "resonance", "wood", "dream", "cherry", "tree", "fog", "frost",
  "voice", "paper", "frog", "smoke", "star"
]

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)]

export function haikuName(): string {
  return `${pick(adjectives)}-${pick(nouns)}-${Math.floor(1000 + Math.random() * 9000)}`
}
