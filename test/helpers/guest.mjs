// A guest link's token for `token`'s account (Play on's guest access,
// src/api/guest.js): registers a device by its first poll, makes the link.
export async function guestToken(baseUrl, token) {
  const headers = { 'Content-Type': 'application/json', 'x-access-token': token };
  const poll = await fetch(`${baseUrl}/api/v1/devices/poll?id=guest-speaker&name=Speaker&type=web&session=guest-session&ack=0`, { headers });
  if (!poll.ok) { throw new Error(`device poll: ${poll.status}`); }
  const r = await fetch(`${baseUrl}/api/v1/devices/guests`, { method: 'POST', headers, body: JSON.stringify({ device: 'guest-speaker' }) });
  if (!r.ok) { throw new Error(`guest link: ${r.status} ${await r.text()}`); }
  return (await r.json()).token;
}
