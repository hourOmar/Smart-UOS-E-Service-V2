import type { AcademicRequestDetails } from '../../data/academicRequests'

// The prototype's strip icons (24-unit grid, 1.7 stroke).
const ICONS = {
  audience:
    'M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11zM3.5 19.5c.9-3 3-4.6 5.5-4.6s4.6 1.6 5.5 4.6M16 10.5a2.7 2.7 0 1 0 0-5.4M17.5 14.6c1.6.5 2.7 2 3.2 4.4',
  requirements:
    'M8 4.5h8M9 3h6v3H9zM6 5h-.5A1.5 1.5 0 0 0 4 6.5v13A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 18.5 5H18M8.5 12.5l2 2 4.5-4.5M8.5 17h7',
  documents: 'M7 3.5h7l4.5 4.5v12.5H7zM14 3.5V8h4.5M10 13h5.5M10 16.5h4',
}

interface ServiceSummaryStripProps {
  details: AcademicRequestDetails
}

// Target Audience, Requirements and Supporting Documents. A value not
// supplied yet leaves its heading in place with no text under it.
function ServiceSummaryStrip({ details }: ServiceSummaryStripProps) {
  const items = [
    { label: 'Target Audience', value: details.audience, icon: ICONS.audience },
    { label: 'Requirements', value: details.requirements, icon: ICONS.requirements },
    {
      label: 'Supporting Documents',
      value: details.supportingDocuments,
      icon: ICONS.documents,
    },
  ]

  return (
    <section className="service-strip" aria-label="Request summary">
      {items.map((item) => (
        <div key={item.label} className="service-strip__item">
          <span className="service-strip__icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d={item.icon} />
            </svg>
          </span>
          <h2 className="service-strip__label">{item.label}</h2>
          {item.value && <p className="service-strip__value">{item.value}</p>}
        </div>
      ))}
    </section>
  )
}

export default ServiceSummaryStrip
