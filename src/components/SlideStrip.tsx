import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTiovivoStore } from '../store/useTiovivoStore'

function SortableThumb({
  id,
  index,
  isActive,
  thumbnail,
  onSelect,
}: {
  id: string
  index: number
  isActive: boolean
  thumbnail?: string
  onSelect: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
  }

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      className={`slide-thumb ${isActive ? 'slide-thumb--active' : ''}`}
      onClick={onSelect}
      {...attributes}
      {...listeners}
    >
      {thumbnail ? (
        <img
          src={thumbnail}
          alt={`Slide ${index + 1}`}
          className="slide-thumb__img"
          draggable={false}
        />
      ) : (
        <span className="slide-thumb__num">{index + 1}</span>
      )}
      <span className="slide-thumb__badge">{index + 1}</span>
    </button>
  )
}

export default function SlideStrip() {
  const slides = useTiovivoStore((s) => s.slides)
  const activeSlideId = useTiovivoStore((s) => s.activeSlideId)
  const setActiveSlide = useTiovivoStore((s) => s.setActiveSlide)
  const addSlide = useTiovivoStore((s) => s.addSlide)
  const removeSlide = useTiovivoStore((s) => s.removeSlide)
  const reorderSlides = useTiovivoStore((s) => s.reorderSlides)
  const thumbnails = useTiovivoStore((s) => s.thumbnails)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (over && active.id !== over.id) {
      reorderSlides(String(active.id), String(over.id))
    }
  }

  return (
    <div className="slide-strip">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={slides.map((s) => s.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="slide-strip__list">
            {slides.map((s, i) => (
              <SortableThumb
                key={s.id}
                id={s.id}
                index={i}
                isActive={s.id === activeSlideId}
                thumbnail={thumbnails[s.id]}
                onSelect={() => setActiveSlide(s.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="slide-strip__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => addSlide()}
        >
          + Slide
        </button>
        {slides.length > 1 && (
          <button
            type="button"
            className="btn btn--ghost btn--danger"
            onClick={() => removeSlide(activeSlideId)}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}
