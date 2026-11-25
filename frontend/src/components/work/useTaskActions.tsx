import { useState } from 'react';
import { CalendarPlus, MessageCircleQuestion, Send } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useConfirm } from '@/context/ConfirmContext';
import { ExtraAction } from './RowActions';
import { ShareTaskModal } from './ShareTaskModal';
import { AskUpdateModal } from './AskUpdateModal';
import { MeetingModal } from './MeetingModal';
import { TaskModal } from './TaskModal';

const idOf = (v: any) => (v && typeof v === 'object' ? String(v._id || '') : v ? String(v) : '');

/**
 * Everything a task row / card / page needs: Send, Ask for update, New meeting, Edit, Delete —
 * one set of modals shared by "All tasks", "My tasks" and the task page.
 */
export function useTaskActions(onChanged: () => void) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [share, setShare] = useState<any>(null);
  const [ask, setAsk] = useState<any>(null);
  const [meet, setMeet] = useState<any>(null);
  const [edit, setEdit] = useState<{ task: any } | null>(null);
  const [create, setCreate] = useState<null | { defaults?: any }>(null);

  const extras = (t: any): ExtraAction[] => {
    const p = t.permissions || {};
    return [
      { key: 'ask', label: 'Ask for update', icon: <MessageCircleQuestion size={15} />, onClick: () => setAsk(t), hidden: !p.view || ['complete', 'closed', 'cancelled', 'abandoned'].includes(t.status) },
      { key: 'share', label: 'Send task…', icon: <Send size={15} />, onClick: () => setShare(t), hidden: !p.share || !!t.confidential },
      { key: 'meet', label: 'New meeting', icon: <CalendarPlus size={15} />, onClick: () => setMeet(t), hidden: !p.view },
    ];
  };

  async function remove(t: any) {
    const ok = await confirm({ title: 'Delete task', message: `Delete “${t.title}”? It can be restored by an administrator.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return false;
    try { await api.delete(`/tasks/${t._id}`); showSuccess('Task deleted.'); onChanged(); return true; } catch (err) { showError(apiErrorMessage(err)); return false; }
  }

  const modals = (
    <>
      <TaskModal open={!!edit} task={edit?.task} limited={!!edit && !edit.task.permissions?.manage} onClose={() => setEdit(null)} onSaved={onChanged} />
      <TaskModal open={!!create} defaults={create?.defaults} onClose={() => setCreate(null)} onSaved={onChanged} />
      <ShareTaskModal open={!!share} task={share} onClose={() => setShare(null)} onDone={onChanged} />
      <AskUpdateModal open={!!ask} task={ask} defaultUserId={ask ? idOf(ask.ownerId) : undefined} onClose={() => setAsk(null)} onDone={onChanged} />
      <MeetingModal open={!!meet} onClose={() => setMeet(null)} onSaved={onChanged}
        context={meet ? { taskId: meet._id, projectId: idOf(meet.projectId) || undefined, milestoneId: idOf(meet.milestoneId) || undefined, title: meet.title, kind: meet.parentTaskId ? 'Subtask' : 'Task' } : undefined} />
    </>
  );

  return { extras, remove, modals, openEdit: (task: any) => setEdit({ task }), openCreate: (defaults?: any) => setCreate({ defaults }), openShare: setShare, openAsk: setAsk, openMeeting: setMeet };
}
