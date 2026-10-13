import { useState } from 'react'

export interface AccordionSection {
  key: string
  title: string
  intro?: string
  items: string[]
  /** Numbered markers (steps) instead of bullets. */
  numbered?: boolean
}

interface ServiceAccordionProps {
  sections: AccordionSection[]
  /** Section keys open on first view; the prototype opens Description. */
  initiallyOpen?: string[]
}

// Expandable sections; each header is a button that shows or hides its
// panel and reports the state to assistive technology.
function ServiceAccordion({ sections, initiallyOpen = [] }: ServiceAccordionProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initiallyOpen))

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="service-accordion">
      {sections.map((section) => {
        const isOpen = open.has(section.key)
        const buttonId = `service-accordion-button-${section.key}`
        const panelId = `service-accordion-panel-${section.key}`
        // A section whose content is not supplied yet keeps its heading but
        // renders no (blank) panel.
        const hasContent = Boolean(section.intro) || section.items.length > 0
        const showPanel = isOpen && hasContent

        return (
          <div key={section.key} className="service-accordion__section">
            <h2 className="service-accordion__heading">
              <button
                id={buttonId}
                type="button"
                className="service-accordion__toggle"
                data-open={isOpen}
                aria-expanded={isOpen}
                aria-controls={showPanel ? panelId : undefined}
                onClick={() => toggle(section.key)}
              >
                <span className="service-accordion__sign" aria-hidden="true">
                  {isOpen ? '−' : '+'}
                </span>
                {section.title}
              </button>
            </h2>

            {showPanel && (
              <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                className="service-accordion__panel"
              >
                {section.intro && (
                  <p className="service-accordion__intro">{section.intro}</p>
                )}
                {section.items.length > 0 && (
                  <ol className="service-accordion__list">
                    {section.items.map((item, index) => (
                      <li key={item} className="service-accordion__item">
                        <span
                          className="service-accordion__mark"
                          data-numbered={Boolean(section.numbered)}
                          aria-hidden="true"
                        >
                          {section.numbered ? index + 1 : '•'}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default ServiceAccordion
