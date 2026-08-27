import { useEffect, useRef } from 'react'
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
import { Neaticon } from './Neaticon'

function SortableThumb({
  id,
  index,
  isActive,
  thumbnail,
  aspect,
  onSelect,
  onFocus,
}: {
  id: string
  index: number
  isActive: boolean
  thumbnail?: string
  aspect: string
  onSelect: () => void
  /** Double-click — centre the canvas on this slide. */
  onFocus: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.85 : 1,
    aspectRatio: aspect,
  }

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      className={`slide-thumb ${isActive ? 'slide-thumb--active' : ''}`}
      data-slide-id={id}
      onClick={onSelect}
      onDoubleClick={onFocus}
      title={`Slide ${index + 1} — double-click to centre it on the canvas`}
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

/**
 * Bottom slide deck — an overview rail under the canvas. Click to jump,
 * drag to reorder, "+" appends. Thumbnails regenerate live from the store;
 * their aspect follows the document format.
 */
export default function SlideStrip({
  onFocusSlide,
}: {
  /** Double-click on a thumb — centre the canvas on that slide. */
  onFocusSlide?: (slideId: string) => void
}) {
  const slides = useTiovivoStore((s) => s.slides)
  const activeSlideId = useTiovivoStore((s) => s.activeSlideId)
  const setActiveSlide = useTiovivoStore((s) => s.setActiveSlide)
  const addSlide = useTiovivoStore((s) => s.addSlide)
  const reorderSlides = useTiovivoStore((s) => s.reorderSlides)
  const thumbnails = useTiovivoStore((s) => s.thumbnails)
  const dimensions = useTiovivoStore((s) => s.dimensions)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (over && active.id !== over.id) {
      reorderSlides(String(active.id), String(over.id))
    }
  }

  const aspect = `${dimensions.width} / ${dimensions.height}`

  /* Keep the active thumb in view when the selection changes from anywhere
     (canvas label, deck, keyboard). Strip-local scrollLeft math — never
     scrollIntoView, which scrolls every scrollable ancestor too. */
  const stripRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const strip = stripRef.current
    const el = strip?.querySelector<HTMLElement>(`[data-slide-id="${activeSlideId}"]`)
    if (!strip || !el) return
    const sr = strip.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    let delta = 0
    if (er.left < sr.left + 10) delta = er.left - sr.left - 14
    else if (er.right > sr.right - 10) delta = er.right - sr.right + 14
    if (delta !== 0) strip.scrollTo({ left: strip.scrollLeft + delta, behavior: 'smooth' })
  }, [activeSlideId])

  /* Left/right arrows walk the deck while it has focus — scoped here so
     they never fight the canvas's arrow-key nudging. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const idx = slides.findIndex((s) => s.id === activeSlideId)
    if (idx < 0) return
    const next = Math.max(0, Math.min(slides.length - 1, idx + (e.key === 'ArrowRight' ? 1 : -1)))
    if (next === idx) return
    e.preventDefault()
    const id = slides[next]!.id
    setActiveSlide(id)
    requestAnimationFrame(() => {
      stripRef.current?.querySelector<HTMLElement>(`[data-slide-id="${id}"]`)?.focus()
    })
  }

  return (
    <div className="slide-strip" ref={stripRef} onKeyDown={onKeyDown}>
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
                aspect={aspect}
                onSelect={() => setActiveSlide(s.id)}
                onFocus={() => {
                  setActiveSlide(s.id)
                  onFocusSlide?.(s.id)
                }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        className="slide-thumb slide-thumb--add"
        style={{ aspectRatio: aspect }}
        onClick={() => addSlide()}
        title="Add slide"
      >
        <Neaticon name="plus" style={{ width: 14, height: 14 }} />
      </button>
    </div>
  )
}
