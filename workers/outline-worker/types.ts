export type OutlineSection = {
  heading: string;
  intent: string;
  bullets: string[];
};

export type OutlineFaq = {
  question: string;
  answerIntent: string;
};

export type OutlineResult = {
  title: string;
  slug: string;
  metaTitle: string;
  metaDescription: string;
  sections: OutlineSection[];
  faqs: OutlineFaq[];
};
