// The server's load as the admin sees it (2026-11-17, the owner: «ver la carga del multijugador en el servidor desde el
// admin será útil para la monitorización»): one sample every few seconds, kept for the last hour in the server's memory
// (a deploy starts it again), plus the sample of right now.

export interface AdminLoadSample {
  /** When (ISO). */
  at: string;
  /** Rooms open by state, and how many fit at once (live config coop.maxRooms). */
  rooms: { lobby: number; starting: number; running: number; max: number };
  /** Players in rooms. */
  players: number;
  /** Group runs playing, and their players with the run open. */
  coop: { runs: number; connected: number };
  /** Solo runs being played (live feeds). */
  solo: number;
  /** Live sockets open. */
  sockets: number;
  /** The group runs' referee: the share of one CPU core all of them take, and the worst step's p99 (ms). */
  referee: { core: number; p99: number };
  /** The event loop's delay (ms) since the last sample: a busy server answers late. */
  loop: { p50: number; p99: number; max: number };
  /** The process's CPU since the last sample, as a share of one core (1 = a whole core). */
  cpu: number;
  /** Memory (bytes): resident, and the JavaScript heap in use. */
  memory: { rss: number; heap: number };
  /** Seconds since the process started (since the last deploy). */
  uptime: number;
}

export interface AdminLoadView {
  now: AdminLoadSample;
  /** Oldest first. */
  history: AdminLoadSample[];
  /** How often a sample is taken (ms). */
  sampleMs: number;
}
