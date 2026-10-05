// One source for hero copy and the scroll-driven diagram order.
export const heroContent = {
  name: 'Melzi',
  tagline: 'Your all-in-one infrastructure solution',
  action: 'Help shape Melzi',
  features: ['Batteries-included', 'Testable', 'Secure'],
  featureTaglines: [
    'A complete stack with auth, storage, databases and secrets already configured to work together.',
    'Find real issues in isolated clones that match production. Check your fixes under the same conditions before deploying.',
    'Built by security experts to handle common threats automatically, so your team has less security work to do.'
  ],
  slideTitles: ['Your application stack', 'Test on a replica', 'We protect the stack']
} as const;
export type SlideIndex = 0 | 1 | 2;
