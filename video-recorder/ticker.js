// Worker-based ticker: timers in workers are not throttled like page timers,
// giving the recorder a steady frame clock.
let id = null;
self.onmessage = (e) => {
  clearInterval(id);
  if (e.data && e.data.fps) id = setInterval(() => self.postMessage(0), 1000 / e.data.fps);
};
