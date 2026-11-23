/** The web manifest's name, short_name and description; the default file in public/ stays "LINA". */
export function stampManifest(json: string, name: string): string {
  const manifest = JSON.parse(json) as { name: string; short_name: string; description: string };
  manifest.name = name;
  manifest.short_name = name;
  manifest.description = `${name} on the phone Home Screen.`;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
