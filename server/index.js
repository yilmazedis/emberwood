// Start file for the host's Node.js runner (DirectAdmin "Setup Node.js App"), which loads CommonJS.
// The server itself is ES modules (main.mjs), so it can share files with the game in ../src.
import('./main.mjs').catch((err) => {
  console.error(err);
  process.exit(1);
});
