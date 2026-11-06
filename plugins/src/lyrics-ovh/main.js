// Example plugin: a lyrics provider that uses the network permission.
export function activate(api) {
  return api.registerLyrics({
    id: 'ovh', name: 'lyrics.ovh',
    async find(track) {
      const artist = track.artist.split(/,|&| feat\.? | ft\.? /i)[0].trim();
      const response = await api.net.fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(track.title)}`);
      if (!response.ok) return null;
      const { lyrics } = await response.json();
      return lyrics ? { text: lyrics.replace(/\r/g, '').trim() } : null;
    },
  });
}
