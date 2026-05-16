import { useMemo } from 'react'
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTiovivoStore, type PlacedMedia } from '../store/useTiovivoStore'

function LayerRow({
  item,
  isSelected,
  onSelect,
}: {
  item: PlacedMedia
  isSelected: boolean
  onSelect: (additive: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 6px',
    borderRadius: 4,
    background: isSelected ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${isSelected ? 'rgba(59,130,246,0.6)' : 'rgba(255,255,255,0.08)'}`,
    cursor: 'grab',
    userSelect: 'none',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={(e) => onSelect(e.shiftKey || e.metaKey || e.ctrlKey)}
      {...attributes}
      {...listeners}
    >
      <div
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: 3,
          background: 'rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {item.type === 'video' ? (
          <video
            src={item.src}
            muted
            playsInline
            preload="metadata"
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
          />
        ) : item.type === 'text' ? (
          <span
            style={{
              color: 'rgba(255,255,255,0.85)',
              fontWeight: 700,
              fontSize: 13,
              lineHeight: 1,
              fontFamily: 'serif',
            }}
            aria-hidden
          >
            T
          </span>
        ) : (
          <img
            src={item.src}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
          />
        )}
      </div>
      <span
        style={{
          fontSize: 11,
          color: 'rgba(255,255,255,0.85)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
          minWidth: 0,
        }}
        title={item.type === 'text' ? (item.text || item.name) : item.name}
      >
        {item.type === 'text' ? (item.text || 'Text') : item.name}
      </span>
    </div>
  )
}

export default function LayerStack({
  slideId,
  slideIndex,
  slideAbsoluteX,
  slideWidth,
  slideHeight,
  slideAbsoluteXBySlideId,
}: {
  slideId: string
  slideIndex: number
  slideAbsoluteX: number
  slideWidth: number
  slideHeight: number
  slideAbsoluteXBySlideId: Map<string, number>
}) {
  const items = useTiovivoStore((s) => s.items)
  const reorderSlideLayers = useTiovivoStore((s) => s.reorderSlideLayers)
  const setSelected = useTiovivoStore((s) => s.setSelected)
  const toggleSelected = useTiovivoStore((s) => s.toggleSelected)
  const setActiveSlide = useTiovivoStore((s) => s.setActiveSlide)
  const selectedIds = useTiovivoStore((s) => s.selectedIds)

  // Items that visually overlap this slide's region (both X and Y).
  // All slides share the same Y range, so Y overlap is: item.y..item.y+h vs 0..slideHeight.
  const slideItems = useMemo(() => {
    const slideLeft = slideAbsoluteX
    const slideRight = slideAbsoluteX + slideWidth
    return items.filter((it) => {
      const homeX = slideAbsoluteXBySlideId.get(it.slideId)
      if (homeX === undefined) return false
      const itemLeft = homeX + it.x
      const itemRight = itemLeft + it.width
      const xOverlap = itemRight > slideLeft && itemLeft < slideRight
      const yOverlap = it.y + it.height > 0 && it.y < slideHeight
      return xOverlap && yOverlap
    })
  }, [items, slideAbsoluteX, slideWidth, slideHeight, slideAbsoluteXBySlideId])

  // Top of list = top of z-stack = last in global array.
  const displayItems = useMemo(() => slideItems.slice().reverse(), [slideItems])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const fromIdx = displayItems.findIndex((it) => it.id === active.id)
    const toIdx = displayItems.findIndex((it) => it.id === over.id)
    if (fromIdx < 0 || toIdx < 0) return
    const newDisplay = displayItems.slice()
    const [moved] = newDisplay.splice(fromIdx, 1)
    newDisplay.splice(toIdx, 0, moved!)
    const orderedIds = newDisplay.slice().reverse().map((it) => it.id)
    reorderSlideLayers(slideId, orderedIds)
  }

  if (slideItems.length === 0) return null

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: 6,
        background: 'rgba(20,20,28,0.85)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'rgba(255,255,255,0.4)',
          fontFamily: 'var(--mono)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          padding: '2px 4px 4px',
        }}
      >
        Layers · Slide {slideIndex + 1}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={displayItems.map((it) => it.id)} strategy={verticalListSortingStrategy}>
          {displayItems.map((it) => (
            <LayerRow
              key={it.id}
              item={it}
              isSelected={selectedIds.includes(it.id)}
              onSelect={(additive) => {
                setActiveSlide(slideId)
                if (additive) toggleSelected(it.id)
                else setSelected(it.id)
              }}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}
