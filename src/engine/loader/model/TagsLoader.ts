/**
 * TagsLoader — Parse tags.txt files for bone-based model attachment
 *
 * Tags define attachment points on model bones with position/rotation offsets.
 * This enables data-driven positioning: edit tags.txt, reload, see changes.
 * No code changes needed to tweak attachment positions.
 *
 * File format (one tag per line):
 *   tag "<bone_name>" "<tag_name>" <fwd> <right> <up> <pitch> <yaw> <roll>
 *
 * Example:
 *   tag "Bip01 R Hand" "tag_weapon" -2 0 0 0 0 0
 *   tag "" "tag_barrel" 0 0 0 0 0 0
 *
 * Empty bone name "" means "attach to model root".
 * Comments start with // and blank lines are ignored.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export interface TagDef {
  /** Bone name in the skeleton (empty string = model root) */
  boneName: string;
  /** Tag identifier (e.g. "tag_barrel", "tag_weapon") */
  tagName: string;
  /** Position offset: forward, right, up */
  offset: Vector3;
  /** Rotation offset: pitch, yaw, roll (degrees) */
  rotation: Vector3;
}

/**
 * Parse a tags.txt file content into TagDef entries.
 */
export function parseTags(content: string): TagDef[] {
  const tags: TagDef[] = [];

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    // Skip blanks and comments
    if (!line || line.startsWith("//")) continue;

    // Match: tag "<bone>" "<tagname>" <6 numbers>
    const match = line.match(
      /^tag\s+"([^"]*)"\s+"([^"]+)"\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/,
    );
    if (!match) continue;

    const [, boneName, tagName, fwd, right, up, pitch, yaw, roll] = match;

    tags.push({
      boneName,
      tagName,
      offset: new Vector3(parseFloat(fwd), parseFloat(right), parseFloat(up)),
      rotation: new Vector3(
        (parseFloat(pitch) * Math.PI) / 180,
        (parseFloat(yaw) * Math.PI) / 180,
        (parseFloat(roll) * Math.PI) / 180,
      ),
    });
  }

  return tags;
}

/**
 * Fetch and parse a tags.txt from a URL path.
 * Returns empty array if file doesn't exist (no error).
 */
export async function loadTags(dirPath: string): Promise<TagDef[]> {
  const url = `${dirPath}tags.txt`;
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const content = await response.text();
    const tags = parseTags(content);
    if (tags.length > 0) {
      console.log(`[TagsLoader] Loaded ${tags.length} tags from ${url}`);
    }
    return tags;
  } catch {
    return [];
  }
}

/**
 * Find a specific tag by name from a tag list.
 */
export function findTag(tags: TagDef[], tagName: string): TagDef | undefined {
  return tags.find((t) => t.tagName === tagName);
}
