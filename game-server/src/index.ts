import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { BackendClient } from './api/BackendClient';
import { config } from './config';
import { GameRoom } from './game/GameRoom';

const backend = new BackendClient();
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? [] },
});

// ─── Match queue ───────────────────────────────────────────────────────────────

const BUY_IN = 1.5; // R$ 1,50 per match
let waitingRoom: GameRoom | null = null;
const activeRooms = new Map<string, GameRoom>();

function getOrCreateWaitingRoom(): GameRoom {
  if (!waitingRoom || waitingRoom.status !== 'waiting') {
    waitingRoom = new GameRoom(backend, BUY_IN);
  }
  return waitingRoom;
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', async (socket: Socket) => {
  const token = socket.handshake.auth.token as string | undefined;
  if (!token) {
    socket.emit('error', { message: 'Authentication required' });
    socket.disconnect();
    return;
  }

  const user = await backend.getUser(token);
  if (!user) {
    socket.emit('error', { message: 'Invalid token' });
    socket.disconnect();
    return;
  }

  console.log(`[connected] userId=${user.id} socketId=${socket.id}`);
  socket.data.userId = user.id;
  socket.data.email = user.email;

  // Signal client that auth validated and all listeners are registered
  socket.emit('authenticated', { userId: user.id, email: user.email });

  // ── join_queue ─────────────────────────────────────────────────────────────
  socket.on('join_queue', async () => {
    const room = getOrCreateWaitingRoom();

    if (room.getPlayer(user.id)) {
      socket.emit('error', { message: 'Already in queue' });
      return;
    }

    const player = room.addPlayer(user.id, socket.id, user.email);
    socket.data.roomId = room.id;
    socket.join(room.id);

    socket.emit('queued', { roomId: room.id, playerCount: room.playerCount });
    io.to(room.id).emit('room_update', { playerCount: room.playerCount });

    // Start match when room is full
    if (room.playerCount >= config.maxPlayersPerRoom) {
      waitingRoom = null;
      activeRooms.set(room.id, room);
      await room.start();
      io.to(room.id).emit('match_start', { roomId: room.id, matchDurationMs: config.matchDurationMs });
    }

    console.log(`[queue] userId=${user.id} roomId=${room.id} players=${room.playerCount}`);
    void player; // suppress unused warning
  });

  // ── direction ──────────────────────────────────────────────────────────────
  socket.on('direction', (data: { x: number; y: number }) => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    const room = activeRooms.get(roomId);
    if (!room) return;
    room.updateDirection(user.id, data);
  });

  // ── sprint ─────────────────────────────────────────────────────────────────
  socket.on('sprint', (sprinting: boolean) => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    const room = activeRooms.get(roomId);
    if (!room) return;
    room.setSprinting(user.id, sprinting);
  });

  // ── state_request — client polls for game snapshot ─────────────────────────
  socket.on('state_request', () => {
    const roomId = socket.data.roomId as string | undefined;
    if (!roomId) return;
    const room = activeRooms.get(roomId) ?? (waitingRoom?.id === roomId ? waitingRoom : null);
    if (!room) return;
    socket.emit('state', room.getSnapshot());
  });

  // ── disconnect ─────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId as string | undefined;
    console.log(`[disconnected] userId=${user.id}`);
    if (roomId) {
      const room = activeRooms.get(roomId) ?? waitingRoom;
      if (room?.status === 'waiting') room.removePlayer(user.id);
      // Active room: player stays in state but is treated as disconnected
    }
  });
});

// ─── Broadcast loop — push state to all rooms every 100ms ─────────────────────

setInterval(() => {
  for (const [roomId, room] of activeRooms) {
    if (room.status === 'finished') {
      activeRooms.delete(roomId);
      io.to(roomId).emit('match_end', { roomId });
      continue;
    }
    io.to(roomId).emit('state', room.getSnapshot());
  }
}, 100);

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(config.port, () => {
  console.log(`Game server running on port ${config.port}`);
  console.log(`Backend URL: ${config.backendUrl}`);
});
