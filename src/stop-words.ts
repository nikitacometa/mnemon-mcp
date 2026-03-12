/**
 * Stop words for FTS5 query preprocessing.
 * Removed before building MATCH expression to prevent over-restrictive AND queries.
 *
 * Two sets: Russian (personal KB, journal, Cyrillic) and English (technical content).
 * All tokens stored lowercase — caller must .toLowerCase() before lookup.
 */

export const RUSSIAN_STOP_WORDS = new Set([
  // Pronouns
  "я", "ты", "он", "она", "оно", "мы", "вы", "они",
  "мне", "тебе", "ему", "ей", "нам", "вам", "им",
  "меня", "тебя", "его", "её", "нас", "вас", "их",
  "мой", "моя", "моё", "мои", "твой", "твоя", "твоё", "твои",
  "наш", "наша", "наше", "наши", "ваш", "ваша", "ваше", "ваши",
  "свой", "своя", "своё", "свои",
  "этот", "эта", "это", "эти", "тот", "та", "те",
  "себя", "себе", "сам", "сама", "само", "сами",
  // Auxiliary verbs
  "быть", "есть", "был", "была", "было", "были",
  "буду", "будет", "будут", "будем", "будете",
  "является", "являются",
  // Prepositions
  "в", "на", "с", "из", "у", "к", "о", "об", "по", "до",
  "за", "под", "над", "при", "без", "для", "через", "после",
  "перед", "между", "во", "со", "ко", "про",
  // Conjunctions and particles
  "и", "или", "но", "а", "да", "же", "ли", "бы", "вот", "уже",
  "что", "как", "так", "тут", "там", "тоже", "также", "ещё",
  "не", "ни", "нет", "то", "если", "когда", "чтобы", "хотя",
  "них", "него", "неё", "ней", "нём", "ними",
  "всего", "всех", "всему", "всем", "всеми",
  "имеют", "имеет", "иметь", "имел", "имела", "имели",
  // Question words (navigational — no semantic value in search)
  "кто", "где", "куда", "откуда", "зачем", "почему", "чем",
  "какой", "какая", "какое", "какие", "который", "которая", "которое", "которые",
  "сколько", "насколько",
  "каков", "какова", "каково", "каковы",
  "каком", "каким", "какому", "какими", "какого",
  // Navigational verbs (describe searching/finding, not content)
  "хранится", "хранятся", "хранить",
  "находится", "находятся", "найти",
  "содержит", "содержится", "содержать",
  "описан", "описана", "описано", "описаны", "описывает",
  "указан", "указана", "указано",
  "ведётся", "ведутся",
  "насчитывает",
  "упоминается", "упоминаются",
  "относится", "относятся",
  // Temporal/narrative verbs — describe events, not content topics
  "произошло", "произошёл", "произошла", "произошли", "происходило",
  "случилось", "случился", "случилась", "случились",
  "делал", "делала", "делали", "делало",
  "проходил", "проходила", "прошёл", "прошла", "прошли",
  // Generic navigational nouns
  "информация", "информации", "информацию", "информацией",
  "файл", "файла", "файле", "файлу", "файлом", "файлы",
  // Generic adjectives/nouns describing state — navigational, not content
  "текущий", "текущая", "текущее", "текущие", "текущего", "текущем",
  "состояние", "состоянии", "состоянием", "состояния",
  "данные", "данных", "данным", "данными",
  // "серия" is too common (book series, TV series, habit streaks) — too ambiguous
  "серия", "серии", "серий", "серию", "серией", "серийный",
  // Generic time nouns — too common to be discriminative
  "год", "года", "году", "годом", "годов", "годы",
  "лет", "лето", "лета",
  "время", "времени", "временем",
]);

export const ENGLISH_STOP_WORDS = new Set([
  // Articles
  "a", "an", "the",
  // Auxiliary verbs
  "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "will", "would", "can", "could", "shall", "should", "may", "might", "must",
  // Pronouns
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "it", "they",
  "him", "his", "her", "its", "us", "their", "them",
  "this", "that", "these", "those",
  // Prepositions
  "in", "on", "at", "to", "from", "of", "for", "with", "by",
  "about", "into", "through", "during", "before", "after",
  "above", "below", "between", "under", "over",
  // Conjunctions and particles
  "and", "or", "but", "not", "no", "so", "if", "as", "than",
  "also", "already", "still", "just", "very", "more", "most",
  // Question words (navigational)
  "what", "who", "which", "where", "when", "why", "how", "whose",
]);

/** Extra stop words loaded from config (e.g. owner name forms) */
const extraStopWords = new Set<string>();

/** Register additional stop words at runtime (from config.extra_stop_words) */
export function addExtraStopWords(words: string[]): void {
  for (const w of words) {
    extraStopWords.add(w.toLowerCase());
  }
}

/** Check if a token (lowercase) is a stop word in either language */
export function isStopWord(token: string): boolean {
  return RUSSIAN_STOP_WORDS.has(token) || ENGLISH_STOP_WORDS.has(token) || extraStopWords.has(token);
}
