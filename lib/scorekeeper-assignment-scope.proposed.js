// Review-only versioned assignment policy. Scope is an authoritative server
// record, never derived from the browser's team labels or player names.
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const text=(x,max,required=false)=>typeof x==='string'&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x)&&(!required||x.trim().length>0);
const int=n=>Number.isSafeInteger(n)&&n>=0&&n<=2147483647;
const playerKey=p=>JSON.stringify([p.side,p.player_number,p.player_name]);
const validIdentity=p=>plain(p)&&['home','away'].includes(p.side)&&text(p.player_number,40)&&text(p.player_name,160,true);
const gameFields=['game_date','game_time','court','division','grade','format','period','home_team','away_team','home_score','away_score','home_fouls','away_fouls','home_quarter_points','away_quarter_points','target_score'];
const stats=['pts','reb','ast','stl','blk','turnovers','fouls','ftm','ftx'];
const quarter=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=4&&Number.isInteger(n*2);
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function validAssignmentScope(scope){
 if(!plain(scope)||!['scorekeeper-scope-v1','scorekeeper-scope-v2-one-team'].includes(scope.version)||!text(scope.homeTeam,160,true)||!text(scope.awayTeam,160,true)||scope.homeTeam===scope.awayTeam||!['classic','quarter','challenge'].includes(scope.format)||!Array.isArray(scope.roster)||scope.roster.length>200||scope.roster.some(p=>!validIdentity(p)||Object.keys(p).length!==3))return false;
 if(scope.version==='scorekeeper-scope-v2-one-team'&&(scope.format!=='classic'||scope.roster.some(p=>p.side!=='home')))return false;
 return new Set(scope.roster.map(playerKey)).size===scope.roster.length;
}
export function evaluateScopedPayload(scope,game,players){
 if(!validAssignmentScope(scope))return 403;
 const oneTeam=scope.version==='scorekeeper-scope-v2-one-team';
 if(!plain(game)||Object.keys(game).length!==gameFields.length||gameFields.some(k=>!Object.hasOwn(game,k))||!Array.isArray(players)||players.length>200||!text(game.home_team,160,true)||!text(game.away_team,160,true)||!['classic','quarter','challenge'].includes(game.format)||game.period!=='FINAL'||!validDate(game.game_date)||!(game.game_time===null||text(game.game_time,80))||!['court','division','grade'].every(k=>text(game[k],160))||!['home_score','away_score','home_fouls'].every(k=>int(game[k]))||(oneTeam?game.away_fouls!==null:!int(game.away_fouls))||!quarter(game.home_quarter_points)||!quarter(game.away_quarter_points))return 400;
 if(game.format!=='quarter'&&(game.home_quarter_points!==0||game.away_quarter_points!==0))return 400;
 if(oneTeam&&game.game_time!==null&&!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(game.game_time))return 400;
 if(game.format==='challenge'?(!int(game.target_score)||game.target_score<1):game.target_score!==null)return 400;
 if(game.home_team!==scope.homeTeam||game.away_team!==scope.awayTeam||game.format!==scope.format)return 403;
 const allowed=new Set(scope.roster.map(playerKey)),seen=new Set();
 for(const p of players){if(!validIdentity(p)||Object.keys(p).length!==stats.length+3||stats.some(k=>!int(p[k])))return 400;const key=playerKey(p);if(seen.has(key))return 400;if(!allowed.has(key))return 403;seen.add(key);}
 return 200;
}
