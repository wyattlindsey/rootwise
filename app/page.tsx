import { ChatView } from '@/components/ChatView';

export default function Home(): React.JSX.Element {
  return <ChatView demoMode={process.env.ROOTWISE_FAKE_MODEL === '1'} />;
}
