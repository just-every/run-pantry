// Remote checks isolate installer state under a scratch HOME. Browser drivers
// and Chromium use the account's real home; only rer children keep the scratch.
import {userInfo} from 'node:os'
const accountHome=userInfo().homedir
if(process.env.HOME&&process.env.HOME!==accountHome) {
  process.env.PANTRY_RER_HOME??=process.env.HOME
  process.env.HOME=accountHome
}
