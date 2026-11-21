/* Copy only the requested visual materials. Source games are never modified. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, "../.."),
  base = path.resolve(root, "../../..");
const packs = {
  visual: "Sferorumiya-Visual-Lab",
  prism: "Sferorumiya-Prism-Lab",
  glass: "Sferorumiya-Glass-Lab",
};
const icons = [
  "events",
  "skins",
  "inventory",
  "wardrobe",
  "quests",
  "shop",
  "top",
  "achievements",
  "clan",
  "pets",
];
const avatars = require("../../public/shared/player-identity").skins.map((skin) => skin.id);
const manifest = [];
for (const [id, folder] of Object.entries(packs)) {
  const source = path.join(base, folder, "public");
  const files = [
    [
      id === "glass"
        ? "assets/glass/lobby-background.webp"
        : "visual-lab/art/citadel-background.webp",
      "lobby.webp",
    ],
  ];
  for (const icon of icons)
    files.push([
      id === "glass"
        ? `assets/glass/nav-${icon}.webp`
        : `visual-lab/art/interface/${icon === "top" ? "rankings" : icon}.webp`,
      `nav-${icon}.webp`,
    ]);
  for (const avatar of avatars)
    files.push([
      id === "glass"
        ? `assets/glass/avatar-${avatar}.webp`
        : `visual-lab/art/portraits/${avatar}.webp`,
      `avatars/${avatar}.webp`,
    ]);
  for (const [input, output] of files) {
    const bytes = fs.readFileSync(path.join(source, input));
    const destination = `public/assets/interface-packs/${id}/${output}`;
    fs.mkdirSync(path.dirname(path.join(root, destination)), { recursive: true });
    fs.writeFileSync(path.join(root, destination), bytes);
    manifest.push({
      source: path.join(source, input),
      destination,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
fs.mkdirSync(path.join(root, "docs/artwork/interface-packs"), { recursive: true });
fs.writeFileSync(
  path.join(root, "docs/artwork/interface-packs/import-manifest.json"),
  JSON.stringify(
    {
      description:
        "Existing generated artwork from the owner's visual copies, imported unchanged. No third-party downloads.",
      files: manifest,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ files: manifest.length, packs: Object.keys(packs) }));
