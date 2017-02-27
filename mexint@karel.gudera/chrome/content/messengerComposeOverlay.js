const { require } = Components.utils.import('resource://gre/modules/commonjs/toolkit/require.js', {});
const subprocess = require('sdk/system/child_process/subprocess');
const base64 = require('sdk/base64');
Components.utils.import('resource://gre/modules/FileUtils.jsm');

var OS = Components.classes["@mozilla.org/xre/app-info;1"]
         .getService(Components.interfaces.nsIXULRuntime).OS;
var node = (OS == "WINNT") ? "node.exe" : "node";
var nodePath = FileUtils.getFile("ProfD", ["extensions", "mexint@karel.gudera", "components", node]);
var sendMsgPath = FileUtils.getFile("ProfD", ["extensions", "mexint@karel.gudera", "server", "send_message.js"]);

function encodeUTF8 (str)
{
	return unescape(encodeURIComponent(str));
}

function disableWindow ()
{
	document.documentElement.setAttribute("onclose", "event.preventDefault(); event.stopPropagation();");
	document.getElementById("menu_File").disabled = true;
	document.getElementById("menu_Edit").disabled = true;
	document.getElementById("menu_View").disabled = true;
	document.getElementById("insertMenu").disabled = true;
	document.getElementById("formatMenu").disabled = true;
	document.getElementById("optionsMenu").disabled = true;
	document.getElementById("tasksMenu").disabled = true;
	document.getElementById("helpMenu").disabled = true;
	document.getElementById("button-send").disabled = true;
	document.getElementById("spellingButton").disabled = true;
	document.getElementById("button-attach").disabled = true;
	document.getElementById("button-security").disabled = true;
	document.getElementById("button-save").disabled = true;
	window.setCursor("wait");
}

function enableWindow ()
{
	document.documentElement.setAttribute("onclose", windowOCAttr);
	document.getElementById("menu_File").disabled = false;
	document.getElementById("menu_Edit").disabled = false;
	document.getElementById("menu_View").disabled = false;
	document.getElementById("insertMenu").disabled = false;
	document.getElementById("formatMenu").disabled = false;
	document.getElementById("optionsMenu").disabled = false;
	document.getElementById("tasksMenu").disabled = false;
	document.getElementById("helpMenu").disabled = false;
	document.getElementById("button-send").disabled = false;
	document.getElementById("spellingButton").disabled = false;
	document.getElementById("button-attach").disabled = false;
	document.getElementById("button-security").disabled = false;
	document.getElementById("button-save").disabled = false;
	window.setCursor("auto");
}

function composeAndSendMessage (server)
{
	disableWindow();

	var URL = server.getCharValue("ewsURL");
	var username = server.username;
	var password;
	var authType = server.getCharValue("authType");
	var TLS = server.getCharValue("TLS");

	var passwordManager = Components.classes["@mozilla.org/login-manager;1"]
                          .getService(Components.interfaces.nsILoginManager);

    var nsLoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
    	                                         Components.interfaces.nsILoginInfo,
    	                                         "init");

    var logins = passwordManager.findLogins({}, 'chrome://mexint', null, 'User Registration');
      
	for ( var i = 0; i < logins.length; i++ )
	{
		if ( logins[i].username == username )
		{
			password = logins[i].password;
			break;
		}
	}

	var msgBody = gMsgCompose.editor.outputToString("text/html", 0);
	var attachEnum = gMsgCompose.compFields.attachments;
	var attachments = [];

	while ( attachEnum.hasMoreElements() )
	{
		var attach = attachEnum.getNext().QueryInterface(Components.interfaces.nsIMsgAttachment);
		attachments.push(attach)
	}

	var gSendListener = {
		// nsIMsgSendListener
		onStartSending: function (aMsgID, aMsgSize) {},
		onProgress: function (aMsgID, aProgress, aProgressMax) {},
		onStatus: function (aMsgID, aMsg) {},

		onStopSending: function (aMsgID, aStatus, aMsg, aReturnFile) {
			var istream = Components.classes["@mozilla.org/network/file-input-stream;1"]
			              .createInstance(Components.interfaces.nsIFileInputStream);
			istream.init(aReturnFile, -1, -1, false);
			var bstream = Components.classes["@mozilla.org/binaryinputstream;1"]
			              .createInstance(Components.interfaces.nsIBinaryInputStream);
			bstream.setInputStream(istream);
			var bytes = bstream.readBytes(bstream.available()).replace(/^From:.*(\r\n|\r|\n)/m, ""); // remove From field, because exchange doesn't need it
			var mimeContent_base64 = btoa(bytes);
			var body_base64 = base64.encode(msgBody, "utf-8");
			istream.close();
			bstream.close();

			// we need to pass bcc recipients as argument, because this field doesn't belong to MIME content
			var bccRecipients = gMsgCompose.compFields.bcc.replace(/\s/g, "");

			var exitCode;
			var stdout;
			var stderr;

			let authData_base64 = base64.encode(URL      + '\n' +
		                                        username + '\n' + 
		                                        password + '\n' +
		                                        authType + '\n' +
		                                        TLS,
		                                        "utf-8");

			var p = subprocess.call({
				command: nodePath.path,
				arguments: [sendMsgPath.path, bccRecipients],
				//environment: [],
				charset: "UTF-8",
				//workdir: "",

				stdin: function (stdin) {
					stdin.write(authData_base64 + '\n' + body_base64 + '\n' + mimeContent_base64);
					stdin.close();
				},

				done: function (result) {
					exitCode = result.exitCode;
					stdout = result.stdout;
					stderr = result.stderr;
				},

				mergeStderr: false
			});
			p.wait();

			try
			{
				aReturnFile.remove(false);
			}
			catch (ex) {}

			var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
			                    .getService(Components.interfaces.nsIPromptService);

			if ( stdout == "ERROR" )
			{
				promptService.alert(window, "Error", "Failed to send e-mail");
				enableWindow();
				return;
			}
			else
			{
				promptService.alert(window, "Success", "E-mail was sent");
				enableWindow();
				window.close();
			}
		},

		onGetDraftFolderURI: function (aFolderURI) {},
		onSendNotPerformed: function (aMsgID, aStatus) {}
	};

	let msgSend = Components.classes["@mozilla.org/messengercompose/send;1"]
                  .createInstance(Components.interfaces.nsIMsgSend);

    msgSend.createRFC822Message(getCurrentIdentity(),
                                gMsgCompose.compFields,
                                null,
                                null,
                                false,
                                attachments,
                                null,
                                gSendListener);
}

window.addEventListener("compose-send-message", function (event) {
	var accountManager = Components.classes["@mozilla.org/messenger/account-manager;1"]
                         .getService(Components.interfaces.nsIMsgAccountManager);

	var server = accountManager.getAccount(getCurrentAccountKey()).incomingServer;
	var msgcomposeWindow = document.getElementById("msgcomposeWindow");
	var msgType = msgcomposeWindow.getAttribute("msgtype");
	window.windowOCAttr = document.documentElement.getAttribute("onclose");
  
	// do not continue unless this is an actual send event  
	if ( ! (msgType == nsIMsgCompDeliverMode.Now || msgType == nsIMsgCompDeliverMode.Later) )  
		return;

	if ( server.getBoolValue("mexint") )
	{
		event.preventDefault();
		event.stopPropagation();
		composeAndSendMessage(server);
	}

}, true);