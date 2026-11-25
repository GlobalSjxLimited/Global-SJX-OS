import { ReactNode } from 'react';
import { DndContext, DragEndEvent, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, KeyboardSensor } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

interface KanbanColumnDef { key: string; label: string; }

interface KanbanBoardProps<T> {
  columns: KanbanColumnDef[];
  itemsByColumn: Record<string, T[]>;
  getId: (item: T) => string;
  renderCard: (item: T) => ReactNode;
  onMove: (id: string, fromColumn: string, toColumn: string) => void;
  emptyLabel?: string;
}

function DraggableCard({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        zIndex: isDragging ? 50 : undefined,
        opacity: isDragging ? 0.5 : 1,
        position: isDragging ? 'relative' : undefined,
        touchAction: 'none',
      }}
    >
      {children}
    </div>
  );
}

function DroppableColumn({ id, label, count, children }: { id: string; label: string; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className="kanban-col" style={{ background: isOver ? 'var(--accent-soft)' : undefined, transition: 'background .15s' }}>
      <div className="kanban-col-head">
        <span>{label}</span>
        <span>{count}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Drag-and-drop kanban: drag a card onto a column to move it. Every card also
 * keeps a plain <select> for status/stage (see the callers) as a keyboard-
 * and screen-reader-accessible alternative — drag-and-drop alone is not
 * operable by keyboard, so it can never be the only way to change a card's
 * status.
 */
export function KanbanBoard<T>({ columns, itemsByColumn, getId, renderCard, onMove, emptyLabel = 'Empty' }: KanbanBoardProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const cardId = String(active.id);
    const toCol = String(over.id).replace('col:', '');
    let fromCol = '';
    for (const [col, items] of Object.entries(itemsByColumn)) {
      if (items.some((it) => getId(it) === cardId)) {
        fromCol = col;
        break;
      }
    }
    if (fromCol && fromCol !== toCol) onMove(cardId, fromCol, toCol);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="kanban">
        {columns.map((col) => (
          <DroppableColumn key={col.key} id={`col:${col.key}`} label={col.label} count={itemsByColumn[col.key]?.length || 0}>
            {(itemsByColumn[col.key] || []).map((item) => (
              <DraggableCard key={getId(item)} id={getId(item)}>
                {renderCard(item)}
              </DraggableCard>
            ))}
            {(itemsByColumn[col.key] || []).length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted-2)', textAlign: 'center', padding: '20px 0' }}>{emptyLabel}</div>
            )}
          </DroppableColumn>
        ))}
      </div>
    </DndContext>
  );
}
