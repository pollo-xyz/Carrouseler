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
  }

  return (
    <div
      ref={setNodeRef}
      className={`layer-stack__row ${isSelected ? 'layer-stack__row--selected' : ''}`}
      style={style}
      onClick={(e) => onSelect(e.shiftKey || e.metaKey || e.ctrlKey)}
      {...attributes}
      {...listeners}
    >
      <div className="layer-stack__thumb">
        {item.type === 'video' ? (
          <video
            src={item.src}
            muted
            playsInline
            preload="metadata"
            draggable={false}
          />
        ) : item.type === 'text' ? (
          <span className="layer-stack__text-icon" aria-hidden>
            T
          </span>
        ) : (
          <img
            src={item.src}
            alt=""
            draggable={false}
          />
        )}
      </div>
      <span
        className="layer-stack__name"
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
  slideAbsoluteY,
  slideWidth,
  slideHeight,
  slideAbsolutePosBySlideId,
}: {
  slideId: string
  slideIndex: number
  slideAbsoluteX: number
  slideAbsoluteY: number
  slideWidth: number
  slideHeight: number
  slideAbsolutePosBySlideId: Map<string, { x: number; y: number }>
}) {
  const items = useTiovivoStore((s) => s.items)
  const reorderSlideLayers = useTiovivoStore((s) => s.reorderSlideLayers)
  const setSelected = useTiovivoStore((s) => s.setSelected)
  const toggleSelected = useTiovivoStore((s) => s.toggleSelected)
  const setActiveSlide = useTiovivoStore((s) => s.setActiveSlide)
  const selectedIds = useTiovivoStore((s) => s.selectedIds)

  // Items that visually overlap this slide's region — fully 2D, so slides
  // in different ROWS never claim each other's items even when they share
  // the same X range.
  const slideItems = useMemo(() => {
    const slideLeft = slideAbsoluteX
    const slideRight = slideAbsoluteX + slideWidth
    const slideTop = slideAbsoluteY
    const slideBottom = slideAbsoluteY + slideHeight
    return items.filter((it) => {
      const home = slideAbsolutePosBySlideId.get(it.slideId)
      if (home === undefined) return false
      const itemLeft = home.x + it.x
      const itemRight = itemLeft + it.width
      const itemTop = home.y + it.y
      const itemBottom = itemTop + it.height
      return itemRight > slideLeft && itemLeft < slideRight &&
        itemBottom > slideTop && itemTop < slideBottom
    })
  }, [items, slideAbsoluteX, slideAbsoluteY, slideWidth, slideHeight, slideAbsolutePosBySlideId])

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

  // Floating under the artboard — an empty stack is pure noise, skip it.
  if (slideItems.length === 0) return null

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      className="layer-stack"
    >
      <div className="layer-stack__title">Layers · Slide {slideIndex + 1}</div>
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
