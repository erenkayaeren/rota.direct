export type Language = 'tr' | 'en';

/** Every visible string. A Messages object must exist for each language (enforced by the type and a test). */
export interface Messages {
  locale: string;
  title: string;
  subtitle: string;
  language: string;
  steps: { search: string; rooms: string; guest: string; done: string };
  search: {
    checkIn: string;
    checkOut: string;
    adults: string;
    children: string;
    submit: string;
    searching: string;
    manage: string;
  };
  results: {
    heading: string;
    summary: (nights: number, adults: number, children: number) => string;
    perNight: string;
    total: string;
    select: string;
    upTo: (guests: number) => string;
    lastRooms: (n: number) => string;
    none: string;
    noneHint: string;
    change: string;
  };
  guest: {
    heading: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    phoneHint: string;
    kvkk: string;
    kvkkLink: string;
    marketing: string;
    submit: string;
    submitting: string;
    back: string;
    yourStay: string;
    payAtHotel: string;
  };
  done: {
    heading: string;
    lead: (email: string) => string;
    code: string;
    room: string;
    dates: string;
    guests: string;
    total: string;
    keepCode: string;
    cancel: string;
    cancelling: string;
    cancelAsk: string;
    cancelYes: string;
    cancelNo: string;
    cancelledHeading: string;
    cancelledBody: string;
    newBooking: string;
  };
  manage: {
    heading: string;
    lead: string;
    code: string;
    email: string;
    submit: string;
    back: string;
  };
  field: {
    dateRequired: string;
    pastDate: string;
    checkOutAfterCheckIn: string;
    tooLong: string;
    tooFar: string;
    adultsRange: string;
    childrenRange: string;
    required: string;
    invalidEmail: string;
    invalidPhone: string;
    kvkkRequired: string;
  };
  /** Messages for server error codes (OpenAPI). `generic` is the fallback for codes not listed. */
  errors: Record<string, string> & { generic: string; network: string };
  nights: (n: number) => string;
  guests: (adults: number, children: number) => string;
  retry: string;
  close: string;
  poweredBy: string;
}
