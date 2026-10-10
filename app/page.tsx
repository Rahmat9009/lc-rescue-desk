import { requireChatGPTUser } from './chatgpt-auth';
import Desk from './desk';
export default async function Page(){await requireChatGPTUser('/');return <Desk/>;}
