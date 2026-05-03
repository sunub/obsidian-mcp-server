import { theme } from "@cli/theme/semantic-colors.js";
import { Box, Text } from "ink";
import { memo } from "react";
import pkg from "../../../package.json" with { type: "json" };

const ASCII_LOGO = `
                                        
         $$$               $$$          
        $   $$            $$  $$        
       $$    $   $$$$$$  $$    $        
       $$    $ $$     $$$$$    $        
       $$    $$         $$$    $        
       $$$$$ $           $$$$$$$        
      $$                       $$       
     $                           $      
     $     $$$  $$$  $$$  $$$    $$     
     $     $$  $$      $$  $$    $$     
     $$       $$  $$$    $      $$      
     $$       $$        $$      $$      
     $          $*XXb$$$         $$     
     $         cc  cccv          $$     
     $  $$$$$uu    n  vu $$$$$$$$$$     
     $$$     x    f    x*$       $$     
     $$     fzz       rr        $$     
     $$    tf  uu ))    ff       $$     
      $$$$$/   )rczcvuu  /t    $$$$     
           ||  |/      |\\$$$$$         
            )()))      (|               
              |111111{11                
`;

const [logoWidth, logoHeight] = [15, 9];
export const CLILogo = memo(() => (
	<>
		<Box
			flexDirection="column"
			alignItems="center"
			borderStyle={"bold"}
			borderColor={theme.text.accent}
			borderTop={true}
			borderBottom={false}
			borderLeft={false}
			borderRight={false}
			paddingTop={3}
		>
			<Box width={logoWidth} height={logoHeight} paddingRight={3}>
				<Text color={theme.text.accent} bold>
					{ASCII_LOGO}
				</Text>
			</Box>

			<Text color={theme.text.accent} bold>
				LLaMA CLI <Text color={theme.text.primary}>v{pkg.version}</Text>
			</Text>
		</Box>
		<Box paddingTop={1}>
			<Text>
				A command-line interface for LLaMA-based local LLM servers, providing
				seamless integration and management of your local LLM resources.
			</Text>
		</Box>
	</>
));
