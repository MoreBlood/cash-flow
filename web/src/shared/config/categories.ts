interface CategoryStyle {
  icon: string;
  color: string;
}

const STYLES: Record<string, CategoryStyle> = {
  Продукты: { icon: '🛒', color: 'var(--green-9)' },
  'Рестораны и доставка': { icon: '🍽️', color: 'var(--orange-9)' },
  Кейтеринг: { icon: '🥗', color: 'var(--lime-9)' },
  Транспорт: { icon: '🚕', color: 'var(--blue-9)' },
  Подписки: { icon: '📺', color: 'var(--violet-9)' },
  Здоровье: { icon: '💊', color: 'var(--red-9)' },
  Развлечения: { icon: '🎭', color: 'var(--pink-9)' },
  Покупки: { icon: '🛍️', color: 'var(--amber-9)' },
  Жильё: { icon: '🏠', color: 'var(--cyan-9)' },
  'Коммунальные и связь': { icon: '📡', color: 'var(--teal-9)' },
  'Налоги и взносы': { icon: '🏛️', color: 'var(--slate-9)' },
  'Комиссии банка': { icon: '🏦', color: 'var(--gray-9)' },
  Семья: { icon: '👨‍👩‍👧', color: 'var(--crimson-9)' },
  Друзья: { icon: '🤝', color: 'var(--yellow-9)' },
  Доход: { icon: '💰', color: 'var(--grass-9)' },
  Питомцы: { icon: '🐾', color: 'var(--orange-11)' },
  'Без категории': { icon: '❓', color: 'var(--gray-8)' },
};

export const categoryStyle = (name: string): CategoryStyle =>
  STYLES[name] ?? { icon: '💳', color: 'var(--gray-9)' };
