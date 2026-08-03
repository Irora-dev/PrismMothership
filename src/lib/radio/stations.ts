// Radio stations. Two kinds:
//  - "playlist": local tracks auto-discovered from /public/radio (drop files in).
//  - "stream":   a continuous internet-radio stream (SomaFM, listener-supported).
export interface BaseStation {
  id: string;
  name: string;
  genre: string;
  accent: string;
}
export interface StreamStation extends BaseStation {
  kind: "stream";
  url: string;
}
export interface PlaylistStation extends BaseStation {
  kind: "playlist";
  folder?: string; // subfolder under /public/radio; omit to use the root mix
}
export type Station = StreamStation | PlaylistStation;

export const STATIONS: Station[] = [
  { id: "prism", name: "Prism Radio", genre: "house · grooves", accent: "#c06aff", kind: "playlist" },
  { id: "garage", name: "Garage Station", genre: "UK garage · bass", accent: "#ff5ac8", kind: "playlist", folder: "Garage Station" },
  { id: "groovesalad", name: "Groove Salad", genre: "ambient · downtempo", url: "https://ice1.somafm.com/groovesalad-128-mp3", accent: "#5cff8f", kind: "stream" },
  { id: "synphaera", name: "Synphaera", genre: "space ambient", url: "https://ice1.somafm.com/synphaera-256-mp3", accent: "#3bd9ff", kind: "stream" },
  { id: "dronezone", name: "Drone Zone", genre: "atmospheric ambient", url: "https://ice1.somafm.com/dronezone-128-mp3", accent: "#7c8bff", kind: "stream" },
  { id: "beatblender", name: "Beat Blender", genre: "deep house · downtempo", url: "https://ice1.somafm.com/beatblender-128-mp3", accent: "#ffe14d", kind: "stream" },
  { id: "lush", name: "Lush", genre: "vocal · chill", url: "https://ice1.somafm.com/lush-128-mp3", accent: "#ff5a5a", kind: "stream" },
  { id: "defcon", name: "DEF CON Radio", genre: "hacker beats", url: "https://ice1.somafm.com/defcon-256-mp3", accent: "#ff9f45", kind: "stream" },
];

// Default to the first playlist station (Garage Station). Falls back to the first
// stream if there's no playlist station.
export const DEFAULT_STATION_INDEX = (() => {
  const playlist = STATIONS.findIndex((s) => s.kind === "playlist");
  return playlist >= 0 ? playlist : STATIONS.findIndex((s) => s.kind === "stream");
})();
