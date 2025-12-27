import { describe, it, expect } from "vitest";
import { MapParser } from "../loader/MapParser";

describe("MapParser", () => {
  describe("parse", () => {
    it("should parse empty content", () => {
      const result = MapParser.parse("");
      expect(result).toEqual([]);
    });

    it("should parse comments only", () => {
      const content = `// This is a comment
// Another comment`;
      const result = MapParser.parse(content);
      expect(result).toEqual([]);
    });

    it("should parse a simple worldspawn entity", () => {
      const content = `{
"classname" "worldspawn"
"message" "Test Map"
}`;
      const result = MapParser.parse(content);
      expect(result).toHaveLength(1);
      expect(result[0].classname).toBe("worldspawn");
      expect(result[0].properties.message).toBe("Test Map");
    });

    it("should parse entity with multiple properties", () => {
      const content = `{
"classname" "info_player_start"
"origin" "0 0 0"
"angle" "90"
}`;
      const result = MapParser.parse(content);
      expect(result).toHaveLength(1);
      expect(result[0].classname).toBe("info_player_start");
      expect(result[0].properties.origin).toBe("0 0 0");
      expect(result[0].properties.angle).toBe("90");
    });

    it("should parse multiple entities", () => {
      const content = `{
"classname" "worldspawn"
}
{
"classname" "light"
"origin" "100 200 300"
"light" "500"
}`;
      const result = MapParser.parse(content);
      expect(result).toHaveLength(2);
      expect(result[0].classname).toBe("worldspawn");
      expect(result[1].classname).toBe("light");
      expect(result[1].properties.origin).toBe("100 200 300");
    });

    it("should parse entity with brush", () => {
      const content = `{
"classname" "worldspawn"
{
( -64 -64 -16 ) ( 64 64 -16 ) ( -64 64 -16 ) texture 0 0 0 1 1
( -64 -64 -32 ) ( -64 64 -32 ) ( 64 64 -32 ) texture 0 0 0 1 1
( -64 -64 -16 ) ( -64 -64 -32 ) ( 64 -64 -16 ) texture 0 0 0 1 1
( -64 64 -16 ) ( 64 64 -16 ) ( -64 64 -32 ) texture 0 0 0 1 1
( -64 64 -16 ) ( -64 64 -32 ) ( -64 -64 -16 ) texture 0 0 0 1 1
( 64 64 -16 ) ( 64 -64 -16 ) ( 64 64 -32 ) texture 0 0 0 1 1
}
}`;
      const result = MapParser.parse(content);
      expect(result).toHaveLength(1);
      expect(result[0].brushes).toHaveLength(1);
      expect(result[0].brushes[0].planes).toHaveLength(6);
    });

    it("should parse plane definition correctly", () => {
      const content = `{
"classname" "worldspawn"
{
( -64 -64 -16 ) ( 64 64 -16 ) ( -64 64 -16 ) mytexture 10 20 45 0.5 2
}
}`;
      const result = MapParser.parse(content);
      const plane = result[0].brushes[0].planes[0];
      expect(plane.p1).toEqual([-64, -64, -16]);
      expect(plane.p2).toEqual([64, 64, -16]);
      expect(plane.p3).toEqual([-64, 64, -16]);
      expect(plane.texture).toBe("mytexture");
      expect(plane.u_offset).toBe(10);
      expect(plane.v_offset).toBe(20);
      expect(plane.rotation).toBe(45);
      expect(plane.u_scale).toBe(0.5);
      expect(plane.v_scale).toBe(2);
    });

    it("should handle inline comments", () => {
      const content = `{
"classname" "worldspawn" // This is the world
"message" "Test" // Map name
}`;
      const result = MapParser.parse(content);
      expect(result[0].classname).toBe("worldspawn");
      expect(result[0].properties.message).toBe("Test");
    });

    it("should parse camera_mode and camera_height", () => {
      const content = `{
"classname" "worldspawn"
"camera_mode" "fake_ortho"
"camera_height" "500"
}`;
      const result = MapParser.parse(content);
      expect(result[0].properties.camera_mode).toBe("fake_ortho");
      expect(result[0].properties.camera_height).toBe("500");
    });

    it("should parse camera_alpha and camera_beta", () => {
      const content = `{
"classname" "worldspawn"
"camera_alpha" "-0.7854"
"camera_beta" "0.5236"
}`;
      const result = MapParser.parse(content);
      expect(result[0].properties.camera_alpha).toBe("-0.7854");
      expect(result[0].properties.camera_beta).toBe("0.5236");
    });

    it("should parse lighting properties", () => {
      const content = `{
"classname" "worldspawn"
"sun_intensity" "0.8"
"moon_intensity" "0.15"
"ambient_intensity" "0.3"
"shadows" "1"
}`;
      const result = MapParser.parse(content);
      expect(result[0].properties.sun_intensity).toBe("0.8");
      expect(result[0].properties.moon_intensity).toBe("0.15");
      expect(result[0].properties.ambient_intensity).toBe("0.3");
      expect(result[0].properties.shadows).toBe("1");
    });

    it("should parse weather properties", () => {
      const content = `{
"classname" "worldspawn"
"weather" "rain"
"weather_intensity" "0.7"
"fog" "1"
"fog_density" "0.05"
}`;
      const result = MapParser.parse(content);
      expect(result[0].properties.weather).toBe("rain");
      expect(result[0].properties.weather_intensity).toBe("0.7");
      expect(result[0].properties.fog).toBe("1");
      expect(result[0].properties.fog_density).toBe("0.05");
    });

    it("should parse time properties", () => {
      const content = `{
"classname" "worldspawn"
"day_length" "300"
"start_hour" "12"
}`;
      const result = MapParser.parse(content);
      expect(result[0].properties.day_length).toBe("300");
      expect(result[0].properties.start_hour).toBe("12");
    });

    it("should parse indoor and playlist properties", () => {
      const content = `{
"classname" "worldspawn"
"indoor" "1"
"playlist" "playlists/spooky.json"
}`;
      const result = MapParser.parse(content);
      expect(result[0].properties.indoor).toBe("1");
      expect(result[0].properties.playlist).toBe("playlists/spooky.json");
    });
  });
});
