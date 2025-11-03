export type SlotType = 'text' | 'date' | 'number' | 'email' | 'phone' | 'address' | 'select' | 'boolean';

export type Slot = {
  key: string;
  label: string;
  type: SlotType;
  required: boolean;
  order?: number;
};

export type SlotUpdate = {
  slotKey: string;
  value: unknown;
};

export type StructuredOutput = {
  slot_updates: SlotUpdate[];
  next_question?: string | null;
  missing_required_slots: string[];
};

