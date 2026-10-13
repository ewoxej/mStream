// The sidebar's items in their groups, and the user's layout of them
// (prefs `sidebar`: per group, the items in order with on / off). Settings
// → Interface edits it. Settings itself always shows (as in the app, it has
// to stay reachable).
export const NAV_GROUPS = [
  { id: 'main', label: null, items: [
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'recent', label: 'Recently played', icon: 'history' },
  ] },
  { id: 'library', label: 'LIBRARY', items: [
    { id: 'albums', label: 'Albums', icon: 'album' },
    { id: 'artists', label: 'Artists', icon: 'person' },
    { id: 'tracks', label: 'All tracks', icon: 'music_note' },
    { id: 'genres', label: 'Genres', icon: 'category' },
    { id: 'folders', label: 'Folders', icon: 'folder' },
    { id: 'fav', label: 'Favorites', icon: 'favorite_border' },
    { id: 'pl', label: 'Playlists', icon: 'queue_music' },
  ] },
  { id: 'tools', label: 'TOOLS', items: [
    { id: 'dj', label: 'Auto DJ', icon: 'auto_awesome' },
    { id: 'sonic', label: 'Sonic Path', icon: 'route', when: (f) => f.sonicPath },
    { id: 'discover', label: 'Discover', icon: 'explore', when: (f) => f.discover },
    { id: 'jukebox', label: 'Jukebox', icon: 'qr_code_2' },
    { id: 'stats', label: 'Stats', icon: 'insights', when: (f) => f.stats },
    { id: 'viz', label: 'Visualizer', icon: 'equalizer' },
    { id: 'dl', label: 'Downloads', icon: 'download', when: (f) => f.torrent },
    { id: 'settings', label: 'Settings', icon: 'settings', fixed: true },
  ] },
];

// Each group's items in the stored order (missing ones appended, on),
// with `on` — unknown ids dropped, Settings always on.
export function sidebarLayout(stored) {
  return NAV_GROUPS.map((g) => {
    const known = (stored?.[g.id] || []).map((x) => ({ ...g.items.find((i) => i.id === x.id), on: x.on !== false }))
      .filter((x, i, a) => x.id && a.findIndex((y) => y.id === x.id) === i);
    const rest = g.items.filter((i) => !known.some((k) => k.id === i.id)).map((i) => ({ ...i, on: true }));
    return { ...g, items: [...known, ...rest].map((i) => (i.fixed ? { ...i, on: true } : i)) };
  });
}

// The stored form of a layout.
export const sidebarPrefs = (layout) => Object.fromEntries(layout.map((g) => [g.id, g.items.map((i) => ({ id: i.id, on: i.on }))]));
