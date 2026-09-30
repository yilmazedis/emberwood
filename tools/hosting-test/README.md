# Hosting test

Not part of the game. The online version of Emberwood needs a server program that runs all the
time and keeps a live WebSocket connection to every player. This tiny test server (no dependencies)
does just that: it accepts WebSocket connections, sends everyone 20 updates a second like a game
server would, answers pings, and reports its CPU speed, memory and process. `client.mjs` measures it.

## On a DirectAdmin host with "Setup Node.js App"

1. **Subdomain:** Subdomain Management → add `gameserver` (so `gameserver.<your domain>`).
   If `https://gameserver.<your domain>` shows a certificate warning, add it to the Let's Encrypt
   certificate under SSL Certificates.
2. **Files** (SSH):
   ```bash
   git -C ~/domains/emberwood.kerimcaglar.com/emberwood pull
   mkdir -p ~/gameserver-test
   cp ~/domains/emberwood.kerimcaglar.com/emberwood/tools/hosting-test/server.js ~/domains/emberwood.kerimcaglar.com/emberwood/tools/hosting-test/package.json ~/gameserver-test/
   ```
3. **Setup Node.js App → Create Application:** newest Node.js version, mode Production,
   application root `gameserver-test`, application URL `gameserver.<your domain>` (nothing after it),
   startup file `server.js`. Create, then start it if it isn't running.
4. Open `https://gameserver.<your domain>`: it should show one line of JSON starting with `{"ok":true`.

## Measure

```bash
node tools/hosting-test/client.mjs https://gameserver.<your domain> 10
```

It reports request and round-trip times, whether the 20-per-second updates arrive on time, how many
connections the host allows at once, whether they are all served by one process (a game world needs
exactly one), and whether they stay open for the given number of minutes.
