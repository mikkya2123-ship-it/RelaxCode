import type { Skill } from '../skills.ts'

/**
 * Copy skills: the words that carry the design. A perfect layout with vague
 * text is still a failed page, and these playbooks are what stops the model
 * from writing "revolutionary solution for your business".
 */
export const CONTENT_SKILLS: Skill[] = [
  {
    id: 'copy-landing',
    title: 'Тексты лендинга',
    titleEn: 'Landing page copy',
    category: 'content',
    summary: 'Оффер, доказательства и CTA в одном тоне, без AI-штампов',
    summaryEn: 'Offer, proof, CTA in one voice, without AI clichés',
    triggers: ['текст лендинга', 'landing copy', 'тексты для сайта', 'написать лендинг', 'оффер'],
    rules: [
      'Write the offer first: who it is for, what it does, what changes. One sentence, no adjectives.',
      'Headlines promise an outcome; a feature name is not a headline.',
      'Every section starts from a question the visitor actually has, in their words.',
      'Proof beats claims: numbers with units, names, screenshots, real quotes.',
      'One voice throughout — if a sentence would not be said out loud, cut it.',
      'Ban the filler: revolutionary, seamless, supercharge, empower, next-gen, "в мире", "под ключ".',
      'CTAs are verbs with the result ("Начать бесплатно"), and the same verb is reused everywhere.',
      'Keep paragraphs under three lines and sentences under 20 words on mobile.',
      'Read the page as one argument: if a section can be deleted without losing the thread, delete it.'
    ]
  },
  {
    id: 'copy-seo',
    title: 'SEO-текст',
    titleEn: 'SEO copywriting',
    category: 'content',
    summary: 'Польза сначала, ключи в заголовках так, как ищут люди',
    summaryEn: 'Usefulness first, keywords phrased the way people search',
    triggers: ['seo текст', 'seo copywriting', 'ключев слов', 'seo статья', 'оптимизац текста'],
    rules: [
      'Write for the reader first; a text that only serves the crawler converts nobody.',
      'Use the query phrasing people actually type, including the questions, in H2s.',
      'One page, one intent: a page targeting three intents ranks for none.',
      'Title under 60 characters, description under 155, both stating the benefit.',
      'Structure with real H2/H3 hierarchy and a scannable list where a list is the honest format.',
      'Link internally with descriptive anchors, never "здесь" or "подробнее".',
      'Do not keyword-stuff: repeated exact-match terms read as spam to both people and engines.',
      'Add the facts that get cited: numbers, dates, sources, prices.',
      'Update instead of duplicating: merge overlapping pages rather than publishing a near-copy.'
    ]
  },
  {
    id: 'copy-email',
    title: 'Письма и рассылки',
    titleEn: 'Email copy',
    category: 'content',
    summary: 'Тема, одно действие, честная отписка',
    summaryEn: 'Subject, one action, honest unsubscribe',
    triggers: ['письмо', 'рассылк текст', 'email copy', 'письма клиентам', 'newsletter copy'],
    rules: [
      'Subject under 50 characters, states the content, no clickbait and no ALL CAPS.',
      'Preview text continues the subject instead of repeating it.',
      'One email, one action; secondary links are visually quieter.',
      'Open with the reason this email was sent in the first line.',
      'Write like a person: no "уважаемый клиент" walls, no five-paragraph intros.',
      'Keep the main message visible without scrolling on a phone (under 100 words).',
      'The unsubscribe link is visible, honest, and works in one click.',
      'Plain-text alternative and a real reply-to address are part of the letter.',
      'Test the subject line on a colleague before sending to a list.'
    ]
  },
  {
    id: 'docs-writing',
    title: 'Документация и README',
    titleEn: 'Documentation and README',
    category: 'content',
    summary: 'Задача, шаги, примеры и границы — коротко и по делу',
    summaryEn: 'Task, steps, examples, limits — short and useful',
    triggers: ['документац', 'readme', 'docs writing', 'инструкц', 'руководство пользователя'],
    rules: [
      'Start with what the reader can do after reading, not with a description of the product.',
      'One task per page; title it as the action ("Подключить вебхук"), not as a feature name.',
      'Show a minimal working example before explaining options.',
      'Order the steps as the user will perform them, with the expected result after each.',
      'State prerequisites, limits and what happens on failure.',
      'Use present tense, second person and short sentences; avoid "можно" chains.',
      'Every code block specifies the language and has no placeholder that would not run.',
      'End with what to read next, not with a dead end.',
      'Delete anything that restates the obvious — wrong docs are worse than fewer docs.'
    ]
  },
  {
    id: 'naming',
    title: 'Нейминг',
    titleEn: 'Naming',
    category: 'content',
    summary: 'Понятное имя, произносимое, без конфликтов и моды',
    summaryEn: 'Clear, pronounceable, conflict-free, not fashionable',
    triggers: ['нейминг', 'naming', 'название продукт', 'имя бренда', 'придумать название'],
    rules: [
      'Name what the thing does, not what it feels like: descriptive beats invented by default.',
      'Test pronunciation aloud, over the phone and in a sentence with a verb.',
      'Check the domain, the store, the trademark and the social handle before falling in love with it.',
      'Avoid hard-to-spell constructions (replacements of letters, stacked consonants) and ambiguous plurals.',
      'Keep it 1-3 syllables and under 12 characters for a product; shorter survives UI.',
      'Avoid trendy suffixes (-ly, -ify, -io) if the product should outlive the trend.',
      'Check the meaning in the main markets, including unwanted slang.',
      'Write the tagline that explains the name; if the tagline is needed every time, rename.',
      'Decide the convention for the range (product, feature, plan) before naming the first one.'
    ]
  },
  {
    id: 'release-notes',
    title: 'Release notes',
    titleEn: 'Release notes',
    category: 'content',
    summary: 'Что изменилось для пользователя, а не список коммитов',
    summaryEn: 'What changed for the user, not a commit list',
    triggers: ['release notes', 'что нового текст', 'описан релиз', 'changelog текст', 'релизные заметки'],
    rules: [
      'Write from the user side: what they can now do, not which module was refactored.',
      'Group by added, changed, fixed, removed, with the most impactful first.',
      'One line per change, verb first, with the affected area named.',
      'Quantify when possible ("импорт на 40% быстрее", "меньше на 12 МБ").',
      'Mention breaking changes plainly and how to migrate.',
      'Drop internal work with no user-visible effect; it belongs in the commit log.',
      'Keep the same terminology as the interface — users search for the words they see.',
      'Add a screenshot or a short clip for anything visual.',
      'End with what is coming next only if there is a real plan behind it.'
    ]
  },
  {
    id: 'tone-of-voice',
    title: 'Tone of voice',
    titleEn: 'Tone of voice',
    category: 'content',
    summary: 'Три принципа, примеры «так/не так» и словарь бренда',
    summaryEn: 'Three principles, do/don’t examples, a brand lexicon',
    triggers: ['tone of voice', 'тон голоса', 'стиль текстов', 'голос бренда', 'brand voice'],
    rules: [
      'Define three adjectives the voice must always satisfy and one it must never be.',
      'Support each adjective with a do and a don’t example sentence, not with a description.',
      'Set the rules for person, contractions, punctuation and emoji in one short list.',
      'Fix the vocabulary: which words the brand uses, which it refuses, and the product name spelling.',
      'Regulate formality per surface (marketing, product UI, error messages, support).',
      'Show the voice in the hard moments: error, payment failure, refund, apology.',
      'Keep sentences short; a long sentence is where a brand voice usually dies.',
      'Give writers a 20-term glossary with replacements for the banned words.',
      'Review real product copy against the guide every release; the guide that is not used is decoration.'
    ]
  },
  {
    id: 'copy-social',
    title: 'Тексты для соцсетей',
    titleEn: 'Social media copy',
    category: 'content',
    summary: 'Первый кадр, одна мысль, конкретный призыв',
    summaryEn: 'A first line that lands, one idea, a concrete ask',
    triggers: ['текст поста', 'соцсети текст', 'social copy', 'caption', 'подпись к посту'],
    rules: [
      'The first line must work alone: it is all the reader sees before "показать ещё".',
      'One idea per post; a second idea is a second post.',
      'Write the caption for the visual, not a description of it — add what the image cannot say.',
      'Concrete beats clever: a number, a named result, a real detail.',
      'End with one specific ask ("напишите, какой вариант нужен"), not "ставьте лайк".',
      'Keep the hook under 12 words and the whole caption under 400 characters.',
      'No hashtag walls; three to five relevant tags at most.',
      'Match the platform register — a LinkedIn post and a TikTok caption are not the same text.',
      'Check the preview crop: the first line and the CTA must survive a truncated view.'
    ]
  }
]
