"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(cls)n.className=cls; return n; };
  class AdminSecurityPanel {
    constructor({api,fail,onAuth,onChallenge,onBack}) {
      Object.assign(this,{api,fail,onAuth,onChallenge,onBack}); this.loaded=false;
      $("twoFactorForm").onsubmit=e=>this.run(e,async()=>{
        const body={code:$("loginOtp").value.trim(),newPassword:$("loginNewPassword").value};
        $("loginOtp").value=""; $("loginNewPassword").value="";
        const result=await api("auth/verify",body); this.clearChallenge(); await onAuth(result); if(result.recoveryCodes)this.showCodes(result.recoveryCodes);
      });
      $("twoFactorBack").onclick=()=>{this.clearChallenge();onBack();};
      $("ownerFactorForm").onsubmit=e=>this.run(e,async()=>{
        const action=$("ownerFactorAction").value,body=this.proof("factor");
        if(action==="recover-profile"){
          if(!window.confirm("Восстановить игровой профиль владельца в этом браузере? Прогресс сохранится, прежний игровой вход в других браузерах будет заменён."))return;
          await api("recover-profile",body);location.replace("/");return;
        }
        const result=await api("security/"+action,body);
        if(result.recoveryCodes){this.showCodes(result.recoveryCodes);await this.load();}
        else { this.enrollmentId=result.enrollmentId;this.qr($("ownerFactorQr"),result.uri);$("ownerFactorSecret").textContent=result.secret;$("ownerFactorEnrollment").hidden=false;$("ownerFactorCode").focus(); }
      });
      $("ownerFactorConfirm").onsubmit=e=>this.run(e,async()=>{
        const code=$("ownerFactorCode").value.trim();$("ownerFactorCode").value="";
        const result=await api("security/enroll-confirm",{code,enrollmentId:this.enrollmentId});
        this.clearEnrollment();await onAuth(result);await this.load();this.showCodes(result.recoveryCodes);
      });
      $("cancelFactorEnrollment").onclick=()=>this.clearEnrollment();
      $("moderatorCreate").onclick=()=>this.edit("create");
      $("myAdminProfile").onclick=()=>this.openProfile().catch(this.fail);
      $("myAdminCancel").onclick=()=>$("myAdminDialog").close();
      $("myAdminDialog").addEventListener("close",()=>$("myAdminForm").reset());
      $("myAdminForm").onsubmit=e=>this.run(e,async()=>{
        if($("myAdminNewPassword").value!==$("myAdminPasswordRepeat").value)throw Error("Новые пароли не совпадают.");
        const body={...this.proof("myAdmin"),version:this.profileVersion,login:$("myAdminLogin").value,name:$("myAdminName").value,newPassword:$("myAdminNewPassword").value};
        $("myAdminNewPassword").value="";$("myAdminPasswordRepeat").value="";
        const result=await api("security/profile",body);$("myAdminDialog").close();await onAuth(result);
      });
      $("moderatorCancel").onclick=()=>{$("moderatorForm").hidden=true;$("moderatorForm").reset();};
      $("moderatorForm").onsubmit=e=>this.run(e,async()=>{
        const body={...this.proof("moderator"),action:this.action,id:this.target?.id,version:this.target?.version,login:$("moderatorLogin").value,name:$("moderatorName").value,reason:$("moderatorReason").value};
        const result=await api("moderators",body);$("moderatorForm").hidden=true;$("moderatorForm").reset();this.render(result.moderators);
        if(result.temporaryPassword)this.showCodes(["Логин: "+result.login,"Временный пароль: "+result.temporaryPassword],true);
      });
      $("securityDownload").onclick=()=>{
        const blob=new Blob([$("securityCodes").textContent+"\n"],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=el("a");
        a.href=url;a.download="Killex-admin-codes.txt";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
      $("securityCodesDialog").addEventListener("close",()=>{$("securityCodes").textContent="";});
    }
    async run(event,work) {
      event.preventDefault();const b=event.submitter;if(this.busy)return;this.busy=true;window.KillexControls.state(b,true,false);
      try{await work();}catch(e){if(event.target.id==='myAdminForm')$("myAdminError").textContent=e.message;else this.fail(e);}finally{this.busy=false;window.KillexControls.state(b,false);}
    }
    async openProfile(){
      const p=await this.api("security");if(p.role!=="moderator")return;
      this.profileVersion=p.version;$("myAdminForm").reset();$("myAdminError").textContent="";$("myAdminLogin").value=p.login;$("myAdminName").value=p.name;
      $("myAdminDialog").showModal();$("myAdminName").focus();
    }
    proof(prefix){const password=$(prefix+"Password").value,code=$(prefix+"Otp").value.trim();$(prefix+"Password").value="";$(prefix+"Otp").value="";return{password,code};}
    qr(host,uri){const qr=window.qrcode(0,"M");qr.addData(uri,"Byte");qr.make();host.innerHTML=qr.createSvgTag({cellSize:5,margin:20,scalable:true});host.querySelector("svg").setAttribute("aria-label","QR-код для приложения-аутентификатора");}
    challenge(status){
      this.onChallenge(status.csrf);$("loginPanel").hidden=true;$("twoFactorPanel").hidden=false;
      $("loginOtpTitle").textContent=status.enrollmentRequired?"Подключи двухфакторную защиту":"Код подтверждения";
      $("loginOtpHint").textContent=status.enrollmentRequired?"Добавь ключ в Google Authenticator, задай личный пароль и введи код с телефона.":"Введи код из приложения-аутентификатора или один резервный код.";
      $("loginQrArea").hidden=!status.enrollmentRequired;$("loginNewPasswordLabel").hidden=!status.passwordChangeRequired;$("loginNewPassword").required=!!status.passwordChangeRequired;
      if(status.enrollmentRequired){this.qr($("loginQr"),status.uri);$("loginSecret").textContent=status.secret;}
      $("loginOtp").focus();
    }
    clearChallenge(){$("twoFactorPanel").hidden=true;$("loginQr").replaceChildren();$("loginSecret").textContent="";$("twoFactorForm").reset();}
    clearEnrollment(){this.enrollmentId=null;$("ownerFactorEnrollment").hidden=true;$("ownerFactorQr").replaceChildren();$("ownerFactorSecret").textContent="";$("ownerFactorCode").value="";}
    showCodes(codes,temporary=false){
      $("securityCodesTitle").textContent=temporary?"Данные первого входа":"Резервные коды";
      $("securityCodesHint").textContent=temporary?"Передай данные только этому модератору. При первом входе он задаст свой пароль и подключит 2FA.":"Сохрани коды в безопасном месте отдельно от телефона. Каждый работает один раз. Повторно этот список не показывается.";
      $("securityCodes").textContent=codes.join("\n");$("securityCodesDialog").showModal();
    }
    async load(){
      const [security,list]=await Promise.all([this.api("security"),this.api("moderators")]);this.loaded=true;
      $("ownerFactorState").textContent=security.twoFactorEnabled?"2FA включена · резервных кодов осталось: "+security.recoveryCodesRemaining:"2FA пока не подключена";
      $("ownerFactorState").dataset.enabled=String(security.twoFactorEnabled);
      $("factorOtpLabel").hidden=!security.twoFactorEnabled;$("factorOtp").required=security.twoFactorEnabled;
      $("ownerFactorAction").options[0].textContent=security.twoFactorEnabled?"Перепривязать приложение":"Подключить Google Authenticator";
      $("ownerFactorAction").options[1].disabled=!security.twoFactorEnabled;$("ownerFactorAction").value="enroll-begin";
      $("moderatorCreate").disabled=!security.twoFactorEnabled;$("moderatorRequirement").hidden=security.twoFactorEnabled;
      this.render(list.moderators);
    }
    render(rows){
      const host=$("moderatorList");host.replaceChildren();
      if(!rows.length){host.append(el("p","Модераторов пока нет.","muted"));return;}
      for(const m of rows){const card=el("article",undefined,"moderator-account"),head=el("div");head.append(el("strong",m.name),el("span",m.login,"muted"));
        card.append(head,el("p",m.enabled?(m.twoFactorEnabled?"Доступ включён · 2FA подключена":"Ожидает первого входа и подключения 2FA"):"Доступ отключён"));
        const tools=el("div",undefined,"moderator-actions"),select=el("select");select.setAttribute("aria-label","Действие для "+m.login);
        for(const [value,label] of [["edit","Редактировать профиль"],[m.enabled?"disable":"enable",m.enabled?"Отключить доступ":"Включить доступ"],["reset-password","Сбросить пароль"],["reset-factor","Сбросить 2FA и пароль"]]){const o=el("option",label);o.value=value;select.append(o);}
        const b=el("button","Выбрать");b.type="button";b.onclick=()=>this.edit(select.value,m);tools.append(select,b);card.append(tools);host.append(card);
      }
    }
    edit(action,target){
      this.action=action;this.target=target;$("moderatorForm").reset();$("moderatorForm").hidden=false;
      const labels={create:"Новый модератор",edit:"Редактировать профиль",disable:"Отключить доступ",enable:"Включить доступ","reset-password":"Сбросить пароль","reset-factor":"Сбросить 2FA и пароль"};
      $("moderatorFormTitle").textContent=labels[action]+(target?": "+target.login:"");
      const editing=["create","edit"].includes(action);$("moderatorIdentity").hidden=!editing;for(const id of ["moderatorLogin","moderatorName"])$(id).required=editing;
      $("moderatorLogin").value=target?.login||"";$("moderatorName").value=target?.name||"";
      $("moderatorForm").scrollIntoView({block:"nearest"});$(editing?"moderatorLogin":"moderatorReason").focus();
    }
    lock(){this.loaded=false;this.clearChallenge();this.clearEnrollment();$("ownerFactorForm").reset();$("moderatorForm").reset();$("moderatorForm").hidden=true;$("moderatorList").replaceChildren();$("securityCodesDialog").close();$("securityCodes").textContent="";}
  }
  window.KillexAdminSecurity=AdminSecurityPanel;
})();
