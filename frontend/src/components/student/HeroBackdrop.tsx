import './HeroBackdrop.css'

interface HeroBackdropProps {
  /** The student hero adds faint circuit lines at the top right. */
  circuit?: boolean
}

// The final prototype's light hero background, shared by the student and
// admin dashboards: the dome photograph fading in from the right under
// white and green washes, with a dark band at the top for the header.
function HeroBackdrop({ circuit = false }: HeroBackdropProps) {
  return (
    <div className="hero-backdrop">
      <div
        className="hero-backdrop__photo"
        role="img"
        aria-label="University of Sharjah main building with its dome"
      />
      <div className="hero-backdrop__wash" aria-hidden="true" />
      <div className="hero-backdrop__glow" aria-hidden="true" />
      <div className="hero-backdrop__ring hero-backdrop__ring--inner" aria-hidden="true" />
      <div className="hero-backdrop__ring hero-backdrop__ring--outer" aria-hidden="true" />
      {circuit && (
        <svg
          className="hero-backdrop__circuit"
          viewBox="0 0 190 220"
          fill="none"
          aria-hidden="true"
        >
          <g stroke="#C6F3DC" strokeOpacity=".55" strokeWidth="1">
            <path d="M190 40 L 150 40 L 150 92 L 118 92" />
            <path d="M190 70 L 168 70 L 168 150 L 140 150" />
            <path d="M170 0 L 170 24 L 130 24" />
            <rect x="122" y="160" width="44" height="34" strokeOpacity=".35" />
            <path d="M144 160 V194 M122 177 H166" strokeOpacity=".25" />
          </g>
          <circle cx="118" cy="92" r="2.4" fill="#E9FFF4" />
          <circle cx="140" cy="150" r="2.4" fill="#E9FFF4" />
          <circle cx="130" cy="24" r="2" fill="#E9FFF4" />
        </svg>
      )}
      <div className="hero-backdrop__top" aria-hidden="true" />
      <div className="hero-backdrop__rule" aria-hidden="true" />
      <div className="hero-backdrop__narrow" aria-hidden="true" />
    </div>
  )
}

export default HeroBackdrop
