import { useNavigate, useParams } from 'react-router';
import { CoopArena } from '../coop/CoopArena';

// Watching a group run live (multiplayer plan, phase 7): the run's own arena from the staff watch socket, with a camera
// to choose; leaving goes back to the live rooms.

export function WatchScreen() {
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  const back = () => navigate('/admin/moderacion/salas');
  return <CoopArena key={runId} runId={runId} viewer onExit={back} onAbandon={back} />;
}
