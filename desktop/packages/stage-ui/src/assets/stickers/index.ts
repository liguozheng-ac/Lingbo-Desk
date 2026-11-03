import affectionate from './lingbo-affectionate.png'
import agree from './lingbo-agree.png'
import angry from './lingbo-angry.png'
import awkward from './lingbo-awkward.png'
import celebrate from './lingbo-celebrate.png'
import confused from './lingbo-confused.png'
import disagree from './lingbo-disagree.png'
import happy from './lingbo-happy.png'
import sad from './lingbo-sad.png'
import surprised from './lingbo-surprised.png'
import thanks from './lingbo-thanks.png'
import tired from './lingbo-tired.png'

/** Static LINGBO artwork shared by the catalog and saved chat slices. */
export const chatStickers = [
  { id: 'lingbo-happy', description: 'Happy', src: happy, emotions: ['happy'] as const },
  { id: 'lingbo-sad', description: 'Sad', src: sad, emotions: ['sad'] as const },
  { id: 'lingbo-confused', description: 'Confused', src: confused, emotions: ['confused'] as const },
  { id: 'lingbo-surprised', description: 'Surprised', src: surprised, emotions: ['surprised'] as const },
  { id: 'lingbo-thanks', description: 'Thank you', src: thanks, emotions: ['thanks', 'affectionate'] as const },
  { id: 'lingbo-celebrate', description: 'Celebration', src: celebrate, emotions: ['celebrate', 'happy'] as const },
  { id: 'lingbo-angry', description: 'Angry', src: angry, emotions: ['angry'] as const },
  { id: 'lingbo-tired', description: 'Tired', src: tired, emotions: ['tired'] as const },
  { id: 'lingbo-affectionate', description: 'Love', src: affectionate, emotions: ['affectionate', 'happy'] as const },
  { id: 'lingbo-awkward', description: 'Awkward', src: awkward, emotions: ['awkward'] as const },
  { id: 'lingbo-agree', description: 'Yes', src: agree, emotions: ['agree'] as const },
  { id: 'lingbo-disagree', description: 'No thanks', src: disagree, emotions: ['disagree'] as const },
] as const
